const AWS = require('aws-sdk')

AWS.config.update({
  region: 'eu-central-1',
  ...(!!process.env.LOCAL_DYNAMO_DB && { endpoint: 'http://localhost:8000' }),
})

const DynamoDB = new AWS.DynamoDB.DocumentClient()
const table = 'rockpaper-rtc'

function joinRoomAndGetMembers(room, id) {
  const params = {
    TableName: table,
    Key: { roomid: room },
    UpdateExpression: `ADD members :newMembers`,
    ExpressionAttributeValues: {
      ':newMembers': DynamoDB.createSet([id]),
    },
    ReturnValues: 'UPDATED_NEW',
  }
  return DynamoDB.update(params)
    .promise()
    .then((result) => result.Attributes.members.values)
}

function leaveRoomAndGetMembers(room, id) {
  return DynamoDB.update({
    TableName: table,
    Key: { roomid: room },
    UpdateExpression: `DELETE members :valuesToRemove`,
    ExpressionAttributeValues: {
      ':valuesToRemove': DynamoDB.createSet([id]),
    },
    ReturnValues: 'UPDATED_NEW',
  })
    .promise()
    .then((result) => {
      const members = result.Attributes ? result.Attributes.members.values : []

      // delete room if no members
      return members.length
        ? members
        : DynamoDB.delete({ TableName: table, Key: { roomid: room } }).promise().then(() => [])
    })
}

function getRoomsContaining(id) {
  return DynamoDB.scan({
    TableName: table,
    FilterExpression: 'contains(members, :id)',
    ExpressionAttributeValues: {
      ':id': id,
    },
  })
    .promise()
    .then((result) => result.Items.map((item) => item.roomid))
}

function parse(body = '') {
  const index = body.indexOf(':')
  return index === -1 ? [] : [body.slice(0, index), body.slice(index + 1)]
}

// single level flatten
function flat(arr) {
  return arr.reduce((flattened, elements) => flattened.concat(elements), [])
}

function uniq(arr) {
  return arr.filter((el, i) => arr.indexOf(el) === i)
}

function postToMany(api, ids, msg) {
  return Promise.all(
    ids.map((id) =>
      api
        .postToConnection({
          ConnectionId: id,
          Data: msg,
        })
        .promise()
    )
  )
}

exports.handler = async (event) => {
  const { domainName, stage, connectionId, routeKey } = event.requestContext
  const body = event.body ? event.body.trim() : ''

  const api = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: `${domainName}/${stage}`,
  })

  switch (routeKey) {
    case '$default':
      const [room, message] = parse(body)
      if (!room || !message) {
        return { statusCode: 400, body: '400' }
      }

      return joinRoomAndGetMembers(room, connectionId)
        .then((members) =>
          postToMany(
            api,
            members.filter((id) => id !== connectionId),
            `${room}:${members.length}:${connectionId}:${message}`
          ).then(() => members)
        )
        .then((members) => ({
          statusCode: 200,
          body: `${room}:${members.length}`,
        }))
        .catch((err) => {
          console.error(err)
          return { statusCode: 404, body: '404' }
        })
    case '$disconnect':
      return getRoomsContaining(connectionId)
        .then((rooms) =>
          Promise.all(
            rooms.map((room) =>
              leaveRoomAndGetMembers(room, connectionId).then((members) =>
                postToMany(api, members, `${room}:${members.length}`)
              )
            )
          )
        )
        .then(() => ({ statusCode: 200, body: '200' }))
        .catch((err) => {
          console.error(err)
          return { statusCode: 404, body: '404' }
        })
    default:
      return { statusCode: 200 }
  }
}

const AWS = require('aws-sdk')

function parse(body = '') {
  const index = body.indexOf(':')
  return index === -1 ? [] : [body.slice(0, index), body.slice(index + 1)]
}

exports.handler = async (event) => {
  const { domainName, stage, connectionId } = event.requestContext
  const body = event.body ? event.body.trim() : ''

  if (body === 'id') {
    return { statusCode: 200, body: `id:${connectionId}` }
  }

  const [target, message] = parse(body)
  if (!target || !message) {
    return { statusCode: 400, body: '400' }
  }

  const api = new AWS.ApiGatewayManagementApi({ apiVersion: '2018-11-29', endpoint: `${domainName}/${stage}` })
  return api.postToConnection({ ConnectionId: target, Data: `${connectionId}:${message}` }).promise()
    .then(() => ({ statusCode: 200, body: '200' }))
    .catch(() => ({ statusCode: 404, body: '404' }))
}

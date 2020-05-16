function createTransport(createMoveExchange) {
  function createWSConnection(existingID) {
    function once(ws, handler) {
      const onMessage = (event) => {
        ws.removeEventListener('message', onMessage)
        handler(event)
      }
      ws.addEventListener('message', onMessage)
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket('wss://gk83p50zq2.execute-api.eu-central-1.amazonaws.com/production')
      ws.onerror = err => {
        ws.onerror = null
        reject(err)
      }
      ws.onopen = () => {
        once(ws, (event) => {
          const expectedStart = 'id:'
          if (event.data.startsWith(expectedStart)) {
            const id = event.data.slice(expectedStart.length)

            // try to send a message to existing id to see if it really exists
            if (existingID) {
              once(ws, (event2) => {
                // 200 means success, and success means that message was delivered
                if (event2.data === '200') {
                  resolve([ws, id, existingID])
                } else {
                  resolve([ws, id, id])
                }
              })
              ws.send(`${existingID}:hi`)
            } else {
              resolve([ws, id, id])
            }
          } else {
            reject(event.data)
          }
        })
        ws.send('id')
      }
    })
  }

  function createPlayerConnection(ws, playerID, hostID, onDisconnect) {
    function parse(message) {
      const i = message.indexOf(':')
      return i === -1 ? [] : [message.slice(0, i), message.slice(i + 1)]
    }

    return new Promise(resolve => {
      if (playerID === hostID) {
        console.log('I am host, wait for connection from guest')

        // Wait for somebody to say hi
        const onMessage = ({ data }) => {
          const [opponentID, message] = parse(data)
          if (message === 'hi') {
            ws.removeEventListener('message', onMessage)
            resolve(opponentID)
          }
        }
        ws.addEventListener('message', onMessage)
      } else {
        console.log('I am guest, I already know that host exists')
        resolve(hostID)
      }
    })
      .then(opponentID => {
        const onError = ({ data }) => {
          if (data === '404') {
            ws.removeEventListener('message', onError)
            onDisconnect()
          }
        }
        ws.addEventListener('message', onError)
        ws.addEventListener('close', onDisconnect)

        return {
          sendMessage: message => {
            console.log('sendMessage', message)
            ws.send(`${opponentID}:${JSON.stringify(message)}`)
          },
          onMessage: cb => {
            const onWSMessage = ({ data }) => {
              console.log('receive', data)
              const [sourceID, message] = parse(data)
              if (sourceID === opponentID && message) {
                let parsedMessage
                try {
                  parsedMessage = JSON.parse(message)
                } catch (err) {
                  console.error(err)
                }
                if (parsedMessage) {
                  cb(parsedMessage)
                }
              }
            }
            ws.addEventListener('message', onWSMessage)
          },
        }
      })
  }

  function getOutcome(me, op) {
    if (me === 'rock' && op === 'rock') { return ['tie', 'rock'] }
    if (me === 'rock' && op === 'paper') { return ['lose', 'paper'] }
    if (me === 'rock' && op === 'scissors') { return ['win', 'rock'] }
    if (me === 'paper' && op === 'rock') { return ['win', 'paper'] }
    if (me === 'paper' && op === 'paper') { return ['tie', 'paper'] }
    if (me === 'paper' && op === 'scissors') { return ['lose', 'scissors'] }
    if (me === 'scissors' && op === 'rock') { return ['lose', 'rock'] }
    if (me === 'scissors' && op === 'paper') { return ['win', 'scissors'] }
    if (me === 'scissors' && op === 'scissors') { return ['tie', 'scissors'] }
  }

  let setMove = () => { throw new Error('Can not set move before opponent is connected') }
  return {
    createGame: function(setClientState, existingGameID) {
      const initialState = {
        gameID: null,
        playerID: null,
        isObserver: false,
        playerCount: 0,
        lastWinningMove: null,
        history: [],
      }

      state = initialState
      const setState = (newState) => {
        setClientState(newState)
        state = newState
      }

      const onDisconnect = () => {
        console.log('either opponent disconnected or I disconnected from ws server, reconnect')
        setState(Object.assign({}, initialState))
        connect()
      }

      function connect() {
        createWSConnection(existingGameID)
          .then(([ws, playerID, gameID]) => {
            setState(Object.assign({}, state, {
              gameID: gameID,
              playerID: playerID,
              playerCount: 1,
            }))
            return createPlayerConnection(ws, playerID, gameID, onDisconnect)
          })
          .then(connection => {
            setState(Object.assign({}, state, { playerCount: state.playerCount + 1 }))
            const moveExchange = createMoveExchange(connection.sendMessage, connection.onMessage)
            setMove = moveExchange.setMove
            moveExchange.onOpponentMoved(moves => {
              const outcome = getOutcome(moves[0], moves[1])
              setState(Object.assign({}, state, {
                history: state.history.concat(outcome[0]),
                lastWinningMove: outcome[1]
              }))
            })
          })
      }
      connect()
    },
    setMove: function(move) {
      return setMove(move)
    },
  }
}
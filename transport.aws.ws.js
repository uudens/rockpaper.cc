function createTransport(createMoveExchange) {
  function createWSConnection(room) {
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
          const [room, playerCount] = parse(event.data)
          if (!room) {
            reject(event.data)
          } else {
            resolve([ws, room, playerCount])
          }
        })
        // introduce myself
        ws.send(`${room}:hi`)
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

  function generateRoomId() {
    return `play-${Math.ceil(Math.random() * 1000)}`
  }

  function parse(message) {
    if (message.indexOf(':') === -1) {
      return []
    }

    const [room, playerCount, messageSource, ...messageContent] = message.split(':')
    return [room, parseInt(playerCount, 10), messageSource, messageContent.join(':')]
  }

  function waitForOpponent(ws) {
    return new Promise(resolve => {
      console.log('Waiting for opponent')
      const onMessage = ws.addEventListener('message', event => {
        const [room, playerCount] = parse(event.data)
        if (room && playerCount >= 2) {
          ws.removeEventListener('message', onMessage)
          resolve([ws, playerCount])
        }
      })
      ws.addEventListener('message', onMessage)
    })
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
        createWSConnection(existingGameID || generateRoomId())
          .then(([ws, gameID, playerCount]) => {

            const onError = ({ data }) => {
              if (data === '404') {
                ws.removeEventListener('message', onError)
                onDisconnect()
              }
            }
            ws.addEventListener('message', onError)
            ws.addEventListener('close', onDisconnect)

            setState(Object.assign({}, state, {
              gameID: gameID,
              playerCount: playerCount,
            }))

            return playerCount < 2 ? waitForOpponent(ws) : [ws, playerCount]
          })
          .then(([ws, playerCount]) => {
            setState(Object.assign({}, state, { playerCount: playerCount }))
            const sendMessage = message => ws.send(`${state.gameID}:${JSON.stringify(message)}`)
            const onMessage = cb => ws.addEventListener('message', event => {
              const [room, playerCount, messageAuthor, messageContent] = parse(event.data)
              if (playerCount !== state.playerCount) {
                setState(Object.assign({}, state, { playerCount: playerCount }))
              }
              if (messageContent) {
                let parsedMessage
                try {
                  parsedMessage = JSON.parse(messageContent)
                } catch (err) {
                  console.error(err)
                }
                if (parsedMessage) {
                  cb(parsedMessage)
                }
              }
            })
            const moveExchange = createMoveExchange(sendMessage, onMessage)
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
function createTransport(createMoveExchange) {
  function createPeer(existingID) {
    return new Promise((resolve, reject) => {
      let peer = new Peer(existingID)
      peer.once('error', err => {
        console.log('err cb', err.type)
        if (err.type === 'unavailable-id') {
          peer.destroy()
          peer = new Peer()
          peer.once('error', err2 => {
            reject(err2)
          })
          peer.once('open', () => {
            resolve(peer)
          })
        } else {
          reject(err)
        }
      })
      peer.once('open', () => {
        resolve(peer)
      })
    })
  }

  function createConnection(hostID, peer, onDisconnect) {
    return new Promise(resolve => {
      if (!hostID || peer.id === hostID) {
        console.log('I am host, wait for connection from guest')
        peer.on('connection', conn => {
          console.log('guest connected')
          resolve(conn)
        })
      } else {
        console.log('I am guest, try to connect to host')
        const conn = peer.connect(hostID)
        conn.on('open', () => {
          console.log('connected to host')
          resolve(conn)
        })
      }
    })
      .then(connection => {
        connection.on('close', () => {
          peer.destroy()
          onDisconnect()
        })

        return {
          sendMessage: message => {
            console.log('sendMessage', message)
            connection.send(JSON.stringify(message))
          },
          onMessage: cb => {
            connection.on('data', data => {
              console.log('receive', data)
              cb(JSON.parse(data))
            })
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
        console.log('either peer disconnected or I disconnected from peerjs server, reconnect')
        setState(Object.assign({}, initialState))
        connect()
      }

      function connect() {
        createPeer(existingGameID)
          .then(peer => {
            setState(Object.assign({}, state, {
              gameID: existingGameID || peer.id,
              playerID: peer.id,
              playerCount: 1,
            }))
            return createConnection(existingGameID, peer, onDisconnect)
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
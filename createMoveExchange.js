/**
 * Follows this sequence diagram. Copy and paste this code into https://mermaid-js.github.io/mermaid-live-editor
 * 
 * sequenceDiagram
 *  Note over Alice: gen random salt Sa
 *  Note over Alice: choose move Ma 
 *  Note over Alice: Ha=hash(Sa+Ma+Rb)
 *  Alice->>Bob: commitment: Ha
 *  Note over Bob: knows Alice chosen
 *  Note over Bob: gen random salt Sb
 *  Note over Bob: choose move Mb
 *  Note over Bob: Hb=hash(Sb+Mb+Ra)
 *  Bob->>Alice: commitment: Hb
 *  Note over Alice: knows Bob chosen
 *  Alice->>Bob: revelation: Ma, Sa
 *  Note over Bob: now knows who won
 *  Note over Bob: now can verify Ha
 *  Bob->>Alice: revelation: Mb, Sb
 *  Note over Alice: now knows who won
 *  Note over Alice: now can verify Hb
 */
function createMoveExchange(sendMessage, onMessage) {
  function random() {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0]
  }

  function hash(str) {
    return Promise.resolve(forge_sha256(str))
  }

  let onOpponentMoved = () => { }
  const initialState = {
    Sa: null,
    Ma: null,
    Ha: null,

    Sb: null,
    Mb: null,
    Hb: null,
  }

  let currentState = initialState

  function reducer(state, action) {
    switch (action.type) {
      case 'peer.commitment':
        return Object.assign({}, state, {
          Hb: action.payload
        })
      case 'peer.revelation':
        return Object.assign({}, state, {
          Sb: action.payload.salt,
          Mb: action.payload.move,
        })
      case 'move':
        return Object.assign({}, state, {
          Ma: action.payload.move,
          Sa: action.payload.salt,
          Ha: action.payload.hash,
        })
      default:
        return state;
    }
  }

  function setState(newState) {
    if (newState === currentState) {
      return
    }

    // move chosen, send hash
    if (newState.Ha !== currentState.Ha) {
      sendMessage({ type: 'commitment', payload: newState.Ha })
    }

    // send revelation if we have our own move and opponents commitment
    if ((newState.Hb !== currentState.Hb || newState.Ha !== currentState.Ha) && (newState.Ha && newState.Hb)) {
      sendMessage({ type: 'revelation', payload: { salt: newState.Sa, move: newState.Ma } })
    }

    // opponent's move known
    if (newState.Mb !== currentState.Mb) {
      // verify opponent's move
      hash(newState.Mb + newState.Sb)
        .then(h => {
          if (h !== newState.Hb) {
            throw new Error('Revelation hash does not match commitment ' + h + ', ' + newState.Mb)
          }

          if (!(newState.Mb === 'rock' || newState.Mb === 'paper' || newState.Mb === 'scissors' )) {
            throw new Error('Invalid move from opponent ' + newState.Mb)
          }

          onOpponentMoved([newState.Ma, newState.Mb])
          currentState = initialState // reset
        })
    }

    currentState = newState
  }

  onMessage(message => {
    setState(reducer(currentState, Object.assign({}, message, { type: 'peer.' + message.type })))
  })

  setState(reducer(currentState, { type: 'generateNumber' }))

  return {
    setMove: move => {
      const salt = random()
      return hash(move + salt).then(h => {
        setState(reducer(currentState, { type: 'move', payload: { move: move, salt: salt, hash: h } }))
      })
    },
    onOpponentMoved: cb => { onOpponentMoved = cb }
  }
}
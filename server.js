const crypto = require('crypto')
const https = require('https')
const http = require('http')
const url = require('url')
const fs = require('fs')

const hostname = '0.0.0.0'
const args = process.argv.slice(2)
const port = args[0]
const key = args[1]
const cert = args[2]

let games = []
const playerMap = {} // key: id, value: response

function randomString() {
  return crypto.randomBytes(8).toString('hex')
}

function getPlayerID(res) {
  const id = Object.keys(playerMap).find(id => playerMap[id] === res)
  if (!id) {
    const newID = randomString()
    playerMap[newID] = res
    return newID
  }
  return id
}

function getPlayerByID(id) {
  return playerMap[id]
}

function createGameID() {
  return `play-${Math.floor(Math.random() * 100000)}`
}

function createGame() {
  const gameID = createGameID()
  const game = {
    id: gameID,
    players: [],
    lastWinningMove: null,
    history: [], // index of winner, 0 = first player won, 1 = second player won, -1 = tie
  }
  games.push(game)
  return game
}

function joinGame(game, res) {
  game.players.push({
    res: res,
    move: null,
  })
  notifyPlayers(game)
}

function onLeave(res) {
  // Leave all games which this player is a part of
  games = games.filter(game => {
    const playerIndex = game.players.findIndex(player => player.res === res)
    if (playerIndex > -1) {
      game.players.splice(playerIndex, 1)
    }

    // If game is empty, remove it
    const shouldRemoveGame = game.players.length === 0
    notifyPlayers(game)

    return !shouldRemoveGame
  })

  // Remove from players map
  const id = getPlayerID(res)
  delete playerMap[id]
}

function setMove(game, res, move) {
  game.players.find(player => player.res === res).move = move
  resolveGameIfHasMoves(game)
  notifyPlayers(game)
}

function resolveGameIfHasMoves(game) {
  const player1 = game.players[0]
  const player2 = game.players[1]
  const hasMoves = player1 && player1.move && player2 && player2.move
  if (hasMoves) {
    const winnerIndex = getWinner(player1.move, player2.move)
    game.lastWinningMove = winnerIndex === 0 ? player1.move : player2.move
    game.history.push(winnerIndex)

    // reset player moves in preparation for future games
    player1.move = null
    player2.move = null
  }
}

function getGameByPlayer(res) {
  return games.find(game => game.players.find(player => player.res === res))
}

function getGameByID(id) {
  return games.find(game => game.id === id)
}

function notifyPlayers(game) {
  game.players.forEach((player, playerIndex) => {
    const observingIndex = playerIndex === 0 ? 0 : 1 // hypothetically when more players join, observe second player
    const playerState = {
      gameID: game.id,
      playerCount: game.players.length,
      lastWinningMove: game.lastWinningMove,
      isObserver: playerIndex > 1,
      history: game.history.map(winnerIndex => {
        return winnerIndex === -1 ? 'tie' : winnerIndex === observingIndex ? 'win' : 'lose'
      }),
      playerID: getPlayerID(player.res),
    }
    player.res.write(`event: state\ndata: ${JSON.stringify(playerState)}\n\n`)
  })
}

function getWinner(a, b) {
  if (a === 'rock' && b === 'rock') {
    return -1
  }
  if (a === 'rock' && b === 'paper') {
    return 1
  }
  if (a === 'rock' && b === 'scissors') {
    return 0
  }
  if (a === 'paper' && b === 'rock') {
    return 0
  }
  if (a === 'paper' && b === 'paper') {
    return -1
  }
  if (a === 'paper' && b === 'scissors') {
    return 1
  }
  if (a === 'scissors' && b === 'rock') {
    return 1
  }
  if (a === 'scissors' && b === 'paper') {
    return 0
  }
  if (a === 'scissors' && b === 'scissors') {
    return -1
  }
}

function createServer(...createServerArgs) {
  if (key && cert) {
    const server = https.createServer(
      {
        key: fs.readFileSync(key),
        cert: fs.readFileSync(cert),
      },
      ...createServerArgs
    )

    // Create another server that will redirect HTTP requests to HTTPS
    http
      .createServer((req, res) => {
        res.writeHead(301, { Location: 'https://' + req.headers['host'] + req.url })
        res.end()
      })
      .listen(80, hostname, () => console.log(`Redirect server running at http://${hostname}:80/`))

    return server
  } else {
    return http.createServer(...createServerArgs)
  }
}

const server = createServer((req, res) => {
  if (/^\/game[\?$]/.test(req.url)) {
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Content-Type', 'text/event-stream')

    const { gameID } = url.parse(req.url, true).query
    const existingGame = getGameByID(gameID)

    const game = existingGame || createGame()
    joinGame(game, res)

    req.on('end', () => onLeave(res))
    req.on('close', () => onLeave(res))
    return
  }

  if (req.url.startsWith('/setMove')) {
    const { playerID, move } = url.parse(req.url, true).query
    const player = getPlayerByID(playerID)
    if (!player || !move || !['rock', 'paper', 'scissors'].includes(move)) {
      res.statusCode = 400
      res.end()
      return
    }

    const game = getGameByPlayer(player)
    if (!game) {
      res.statusCode = 500
      res.end()
      return
    }

    res.statusCode = 200
    setMove(game, player, move)
    res.end()
    return
  }

  if (req.url === '/favicon.ico') {
    const buffer = Buffer.from(
      `iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAEfklEQVRYR8WXW2wbRRSG/7NrO740qQtRaJtwcbymBdILQipNkCJEEZSKqEiQPkTepLz0AYSUCiGh8lQQFAEqF/EMadZBRalKhUhfIkClpIRQqQj6gHCcJlxSohLShI3j2N49aDdrx069jh0sdZ/smTP/+WbOP7OzhJv80E3OjzUB8FhXK6CHoGqnafsnM/9nEmUDcCz8NJhOWUm/Jkl5pBAAR+U2EO+BjgG6OzJoB1k+wGj4dYCOWIKMdKqBtp6czE3Ao2EJoF8AiGBOQ6AgBZXfCkGUD3Clcz80PpMVY3RSSFHyAGLhZ8H0UbZN03fRlr4fKgRw0A9NuwbAYQkqJCmd+QDyh2A8b7YRNFQn/FTXr1YEwBDhmDwMxoOmIPMkpEgDETiTgEflCwCarf+/kqRsqZgHzJz5PgCS2Eb3KpeXeNpFjLlnwfBZgKcoFGmvMIBsOP/LrChxNwUj75sAE133IaWbMOYj8CvUGHmjsgAX2j2oq5oGyLMkzAMkRZ40f0VlGYTeZThqo2DvFxUFsHwwCMajlvC/SCRqqak/yVH5XRC6lxOm7iDp5O8VAeBo+GEI9Dh07odAj4FxLGepW6kxcp5j4XNgarXa/4ak1BGWDboSpORzQP2srdvXtP5tEDnArIKEAwCfzQoyXoXUeBSxsX8ArLfavyJJ2WM3e6PdFsA6zd4xghIT6gfaTHrQt9MvLIvxQwAZtd1gtU2BMAJGW445j1Mw8uLaAKLyGRD2G4PT15OTixPxzb4d/mUtHbtB/DIDTxVKQGTMjQ6S1HtirQDfg7DLAsDiRBy5AOrFmU/Tc8m9JFJmufPyCFUCINCb1R1nj6zJAxyVbQGSVxeQmkrAu80PEu1txDqDknyYmvreK3sXFAOI/zwLV70HjltcxVY30/cXgo31REf1gqWyU+BoeBhE5nmfvp7E4ngcvp1LHkjEVEAA3IF1pQAAot5Mgb7hsgCS3zwz5NzsaTEGLYyqSP4RR01LLcglID2bgjoyDedtbpi1XvFU3e6F4M28LM29doyCSuYOkRdtW8C5E0+cI5eQOVDg3OTG4vg8RJ8D2nwanq01phBrDE5oWIiqcG10w1HrgrPWDXLkSf9EkrKjrBXgmPy5Pp9uY4aZ1EyWZugJDYJXBAlLCQwAYzXcwXVw1rntSqKD9Q0U6ptbGVDsIHoLoJdWK7LhB8PtnlB18dCUGKB7esZLB4jJ+8AYKKrKwNy311DdfCvIcaMXcsamIIo1FOhJlA5wud0Fj3scjE12EIYZF8dU+O7PnMY2kYTzFFSyfsqNKvoy4ph8GIzjdgDJPxegLaThkVZZ/gIX14xmcYCLh5zwx78D6IFCEMbWNC6CVQ1e+0oxRnAp0UIH+rWydkEmmMc67oQuDgGoX82QN/QzpkG8m6TIqN3Yku4DHO0KgnTjW6CpdAiegujYS4GeH4uNKQnA3O+Th7yYj78GoucA2G54414MptNw8gt0V+TqasAlA2RLcqV9I3RPB4B9YN4Ohh/EcYBiAIbA9DGFei+tljjT/x/2Wbkw/J0OrgAAAABJRU5ErkJggg==`,
      'base64'
    )
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Length', buffer.length)
    res.end(buffer)
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html')
  res.end(fs.readFileSync('index.html'))
})

server.listen(port, hostname, () => {
  console.log(`Server running at ${key && cert ? 'https' : 'http'}://${hostname}:${port}/`)
})

const fs = require('fs')
const path = require("path");
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const axios = require('axios');
const app = express()
const port = 3006

app.use(cors())
app.use(bodyParser.json())
// Middleware for serving '/dist' directory
const staticFileMiddleware = express.static('dist');
// 1st call for unredirected requests
app.use(staticFileMiddleware);

const SEPERATOR = "%"
const dataDir = path.join(__dirname, "../data")
const finishedGames = require('./assets/finished.json')
const allGames = {}
const inPlay = {}
let cams = []

loadGamePlayback()
/**
 * Saves photo for game (id), index of move and sends back next move
 *
 * index = -1 is Startposition
 * photo name = [id]%[index]%[fen]%[move]%[pgnmove]%[campos]
 * photo name = 1631897814.055475--0--rnbqkbnr_pppppppp_11111111_11111111_11111111_11111N11_PPPPPPPP_RNBQKB1R--g1f3--0.0
 * */

const handleSave = async (req, res) => {
    const {id, index} = req.params
    const {fen, pgnMove} = req.body
    let nIndex = Number.parseInt(index)
    if (!inPlay[id]) {
        res.status(500).send({
            msg: "Please start the game before accessing this Endpoint"
        })
        return;
    }
    // get photo
    const images = (await Promise.all(cams.map(async x => {
        return await axios.get(x + "/picture", {
            responseType: 'arraybuffer'
        })
    }))).filter(x => x.status === 200)

    console.log(cams)
    // save photo to dir
    const imageNames = images.map((x, i) => {
        const fileName = [id, index, fen.replaceAll("/", "_"), inPlay[id][index], pgnMove, i].join(SEPERATOR) + ".jpg"
        fs.writeFile(path.join(dataDir, fileName), x.data, (err) => {
            if (err) console.log(err)
        })
        return fileName
    })


    // send back next move
    const finished = nIndex + 1 >= inPlay[id].length
    if (finished) {
        finishedGames[id] = true
        delete inPlay[id]
        console.log(`Finished Game ${id} with ${inPlay[id].length} moves!`)
        saveFinishedGame()
    }

    res.status(200).send({
        index: !finished ? nIndex + 1 : -1,
        move: !finished ? inPlay[id][nIndex + 1] : null,
        finished,
        images: imageNames
    });
}

app.post('/game/save/:id/:index', handleSave)


app.get('/game/delete/:id', (req, res) => {
    const {id} = req.params
    fs.readdir(dataDir, (err, files) => {
        if (err) return console.log('Unable to read dir: ' + err)

        const allFiles = files
            .filter(fileName => fileName.indexOf(`${id}`) >= 0)

        allFiles
            .forEach(fileName => fs.unlinkSync(path.join(dataDir, fileName)))
        console.log(`Game ${id} deleted and ${allFiles.length} removed!`)
    })

    res.status(200)
})

app.get('/game/replace/:id/:index', [(req, res, next) => {
    const {id, index} = req.params
    if (!inPlay[id]) {
        res.status(500).send({
            msg: "Please start the game before accessing this Endpoint"
        })
        return;
    }

    fs.readdir(dataDir, (err, files) => {
        if (err) return console.log('Unable to read dir: ' + err)

        files
            .filter(fileName => fileName.indexOf(`${id}${SEPERATOR}${index}`) >= 0)
            .forEach(fileName => {
                fs.unlinkSync(path.join(dataDir, fileName))
            })
    })
    next()
}, handleSave])

app.get('/game/photo/list/:id', (req, res) => {
    const {id} = req.params
    res.send(fs.readdirSync(dataDir)
        .filter(fileName => fileName.indexOf(`${id}${SEPERATOR}`) >= 0)
        .reduce((acc, crr) => {
            const index = crr.split(SEPERATOR)[1]
            if (!acc[index]) acc[index] = 0
            acc[index]++
            return acc;
        }, {}));
})

app.get('/game/finished', (_, res) => {
    res.send(finishedGames)
})

app.get('/game/photo/:id/:index', function (req, res) {
    const {id, index} = req.params
    res.send(fs.readdirSync(dataDir)
        .filter(fileName => fileName.indexOf(`${id}${SEPERATOR}${index}`) >= 0))
        .map(fileName => fileName + ".png")
});

app.get('/game/next', async (_, res) => {
    if(cams.length === 0) cams = await searchCAMS()
    const id = Object.keys(allGames)[0]
    inPlay[id] = [...allGames[id]]
    delete allGames[id]
    console.log(`Started Game ${id} with ${inPlay[id].length} moves!`)
    res.send({
        id
    })
})

app.get('/data/:name', (req, res) => {
    const { name } = req.params
    res.sendFile(path.join(dataDir, name))
})

app.get('/cams/search', async (_, res) => {
    cams = await searchCAMS()
    res.send({
        cams
    })
})


app.listen(port, () => {
    console.log(`http://localhost:${port}`)
})


function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}


function saveFinishedGame() {
    fs.writeFile("./assets/finished.json", JSON.stringify(finishedGames, null, 2), (save) => {
        console.log(save)
    })
}

function loadGamePlayback() {
    fs.createReadStream('./assets/games.csv')
        .on('data', (data) => {
            data
                .toString()
                .split("\n")
                .map((row) => row.replace("\r", "").split(","))
                .filter((row) => row.length > 0 && row[0].length > 0 && !finishedGames[row[0]])
                .forEach((crr) => {
                    allGames[crr[0]] = crr.splice(1, crr.length - 1)
                })
        })
        .on('end', () => {
            console.log("Loaded: " + Object.keys(allGames).length)
        })
}

async function searchCAMS() {
    const urlTemplate = "http://192.168.0.ID"
    const urls = Array(255).fill(0).map((_, i) => i).filter(x => x > 1).map(x => urlTemplate.replace("ID", x))
    // get photo
    return (await Promise.all(urls.map(async x => {
        try {
            const response = await axios.get(x + "/picture", {
                responseType: 'arraybuffer',
                timeout: 1000
            })
            return response.status === 200 ? x : null
        } catch (err) {
            return null
        }
    }))).filter(x => x !== null)
}
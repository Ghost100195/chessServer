const Jimp = require('jimp');
const {v4} = require('uuid')
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
const dataDir = path.join(__dirname, "../data/games")
const finishedGames = require('./assets/finished.json')
const allGames = {}
const inPlay = {}
let cams = []


/**
 * /game/start/auto
 * /game/start/manually
 *
 * /game/next/auto/:id/:index
 * /game/next/manually/:id/:index
 *
 * /game/next/manually/finish/:id
 *
 * /game/delete/:id
 *
 * /history/list
 *
 * /image/list/:id
 * /image/list/:id/:index
 * /image/:filename
 *
 * /setup/cam/search
 * */

loadGamePlayback()
/**
 * Saves photo for game (id), index of move and sends back next move
 *
 * index = -1 is Startposition
 * photo name = [id]%[index]%[fen]%[move]%[pgnmove]%[campos]
 * photo name = 1631897814.055475--0--rnbqkbnr_pppppppp_11111111_11111111_11111111_11111N11_PPPPPPPP_RNBQKB1R--g1f3--0.0
 * */

async function saveImage({id, index, fen, pgnMove}){
    // get photo
    const images = (await Promise.all(cams.map(async x => {
        try {
            const response = await axios.get("http://" + x + "/picture", {
                responseType: 'arraybuffer',
                timeout: 5000
            })
            return {
                ip: x,
                status: response.status,
                image: response.data
            }
        }catch(e){
            console.log("Error: No picture from: " + x)
            return {
                ip: x,
                status: 500,
                image: null
            }
        }
    }))).filter(x => x.status === 200)

    // save photo to dir
    return (await Promise.all(images.map(async (x, i) => {
        const fileName = [id, index, fen.replaceAll("/", "_"), inPlay[id][index], pgnMove, i].join(SEPERATOR) + ".jpeg"
        try{
            await Jimp.read(x.image) // check if image is corrupted
            fs.writeFile(path.join(dataDir, fileName), x.image, (err) => {
                if (err) console.log(err)
            })
            return {ip: x.ip, imageName: fileName}
        }catch(e){
            console.log("Corrupted Image from: " + x.ip)
            return null;
        }
    }))).filter(x => x !== null)
}

app.get('/game/start/auto', async (_, res) => {
    if (cams.length === 0) cams = await searchCAMS()
    const id = Object.keys(allGames)[0]
    inPlay[id] = [...allGames[id]]
    delete allGames[id]
    console.log(`Started Game ${id} with ${inPlay[id].length} moves!`)
    res.send({
        id
    })
})

app.get('/game/start/manually', async (_, res) => {
    if (cams.length === 0) cams = await searchCAMS()
    const id = v4()
    inPlay[id] = []
    console.log(`Started Game manuel Game ${id}`)
    res.send({
        id
    })
})

app.post('/game/next/auto/:id/:index', async (req, res) => {
    const {id, index} = req.params
    let nIndex = Number.parseInt(index)
    const imageNames = await saveImage({id, index, ...req.body})

    // send back next move
    const finished = nIndex + 1 >= inPlay[id].length
    if (finished) {
        finishedGames[id] = true
        console.log(`Finished Game ${id} with ${inPlay[id].length} moves!`)
        delete inPlay[id]
        saveFinishedGame()
    }

    res.status(200).send({
        index: !finished ? nIndex + 1 : -1,
        move: !finished ? inPlay[id][nIndex + 1] : null,
        finished,
        images: imageNames
    });
})


app.post('/game/next/manually/:id/:index', async (req, res) => {
    const {id, index} = req.params
    const {move} = req.body
    inPlay[id][index] = move
    const imageNames = await saveImage({id, index, ...req.body})
    res.status(200).send({
        images: imageNames
    });
})

app.get('/game/finish/manually/:id', async (req, res) => {
    const {id} = req.params
    finishedGames[id] = true
    console.log(`Finished Game ${id} with ${inPlay[id].length} moves!`)
    delete inPlay[id]
    saveFinishedGame()

    res.status(200).send()
})


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
}, saveImage])


app.get('/history/list', (_, res) => {
    res.send(finishedGames)
})

app.get('/image/list/:id', function (req, res) {
    const {id} = req.params
    res.send(fs.readdirSync(dataDir)
        .filter(fileName => fileName.indexOf(`${id}${SEPERATOR}`) >= 0))
        .map(fileName => fileName + ".png")
});

app.get('/image/list/:id/:index', function (req, res) {
    const {id, index} = req.params
    res.send(fs.readdirSync(dataDir)
        .filter(fileName => fileName.indexOf(`${id}${SEPERATOR}${index}`) >= 0))
        .map(fileName => fileName + ".png")
});

app.get('/image/:filename', (req, res) => {
    const {filename} = req.params
    res.sendFile(path.join(dataDir, filename))
})


app.get('/setup/cam/search', async (_, res) => {
    cams = await searchCAMS()
    console.log(cams)
    res.send(
        cams
    )
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
            const response = await axios.get(x + "/heartbeat", {
                responseType: 'arraybuffer',
                timeout: 1000
            })
            return response.status === 200 ? x.replace("http://", "") : null
        } catch (err) {
            return null
        }
    }))).filter(x => x !== null)
}
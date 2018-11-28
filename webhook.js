//
// Copyright (c) 2018 Cisco Systems
// Licensed under the MIT License 
//

/* 
 * a Smartsheet webhook based on Express.js,
 * and posting back to Webex Teams.
 * 
 * see Smartsheet webhook spec: https://smartsheet-platform.github.io/api-docs/#creating-a-webhook
 */

// Load environment variables from project .env file
require('node-env-file')(__dirname + '/.env');

// Check we can request Smartsheet
if (!process.env.SMARTSHEET_TOKEN) {
    console.log("Please specify a SMARTSHEET_TOKEN env variable");
    process.exit(1);
}
if (!process.env.SMARTSHEET_ID) {
    console.log("Please specify a SMARTSHEET_ID sheet identifier");
    process.exit(1);
}
if (!process.env.BOT_TOKEN) {
    console.log("Please specify a BOT_TOKEN env variable");
    process.exit(1);
}
if (!process.env.SPACE_ID) {
    console.log("Please specify a SPACE_ID sheet identifier");
    process.exit(1);
}

// Timeout for outgoing request
const DEFAULT_TIMEOUT = 3000; // in seconds

const express = require("express");
const app = express();

const bodyParser = require("body-parser");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Loggers
const debug = require("debug")("s2wt");
const fine = require("debug")("s2wt:fine");
const logChallenge = require("debug")("challenge");
const fineChallenge = require("debug")("challenge:fine");

const started = Date.now();
app.route("/")

    // healthcheck
    .get(function (req, res) {
        fine("helthcheck invoked!");
        res.json({
            message: "Congrats, your app is up and running",
            since: new Date(started).toISOString(),
            version: require('./package.json').version,
            tip: "Register your app as a Smartsheet WebHook to start receiving events"
        });
    })

    // smartsheet webhook endpoint 
    .post(function (req, res) {
        fine("webhook invoked!");

        // Is it a validation handshake? (fired at creation then every 100 calls)
        if (req.headers['smartsheet-hook-challenge']) {
            let challenge = req.headers['smartsheet-hook-challenge'];
            fine(`received handshake challenge: ${challenge}`);
            res.status(200).json({
                smartsheetHookResponse: challenge
            });
            return;
        }

        // is it a Smartsheet Webhook event?
        if ((!req.body) || ('sheet' !== req.body.scope) || (!req.body.events)) {
            console.log("unexpected payload: not a SmartSheet webhook. Aborting...");
            res.status(400).json({
                message: "Bad payload for Webhook",
                details: "either the app is not properly configured, or Smartsheet is running a new API version"
            });
            return;
        }

        // Test the event ties to the correct smartsheet
        //   - the smartsheet id: req.body.scopeObjectId
        if (process.env.SMARTSHEET_ID != req.body.scopeObjectId) {
            // Log a message and send 200 back
            debug(`ignoring webhook event, as it concerns a different stylesheet, wth id: ${req.body.scopeObjectId} instead of expected id: ${process.env.SMARTSHEET_ID}`)
            res.status(200).json({ message: "fine, though wrong smartsheet. The event is being processed by the webhook." });
            return;
        }

        // Event is ready to be processed, let's send a response to smartsheet without waiting any longer
        // Ack webhook trigger
        res.status(200).json({ message: "fine, the event is being processed by the webhook" });

        // Check for row created events
        req.body.events.forEach(event => {
            if (event && ('created' === event.eventType) && ('row' === event.objectType)) {
                fine('confirmed new row/created event');

                // process incoming resource/event, see https://developer.webex.com/webhooks-explained.html
                processRowCreatedEvent(event);
                return;
            }

            // [PENDING] check for status events: newWebhookStatus

        });


        // Not supported event
        /*
        console.log("not supported even: ${req.body.objectType}, no worries...");
        res.status(200).json({
            message: "ack even though we are not processing this event"
        });
        */
    });

function processRowCreatedEvent(event) {

    // Fetch row
    fine(`processing event: ${event.eventType}`)
    const axios = require('axios');
    const sheetUrl = `https://api.smartsheet.com/2.0/sheets/${process.env.SMARTSHEET_ID}/rows/${event.id}`
    const options = {
        timeout: DEFAULT_TIMEOUT,
        headers: { 'Authorization': `Bearer ${process.env.SMARTSHEET_TOKEN}` }
    };

    axios.get(sheetUrl, options)
        .then(function (response) {
            switch (response.status) {
                case 200:
                    // Fetch cells values
                    processRowValues(response.data.cells);
                    return;
                default:
                    // [PENDING]
                    debug(`unexpected error with status: ${response.status}`);
                    return;
            }
        })
        .catch(function (error) {
            // handle error
            debug(`Error while requesting SmartSheet API, msg: ${error.message}`);
            return;
        })
}

// Invoked as a new row is created
function processRowValues(row) {
    fine("new row!");

    // Check entries
    let checker = "**GOOD**";
    let guess = row[4];

    // An entry is invalid if it has no guess, no profile
    // it also needs a full name or a first and last name
    if (!(checkValid(row))) {
        logChallenge(`EMPTY guess, profile or name for participant: ${row[1].value}`);
        checker = "**INVALID**: empty guess, profile or name";
    }
    else {
        // Regarding the weight, the rules state that people MUST enter
        // a weight in kg “with an approximation to the second decimal place”.
        if ((typeof guess.value) !== 'number') {
            let parsed = guess.value.match(/(\d{0,2})[\.|,](\d{0,2})/);
            if ((!parsed) || (parsed.length != 3)) {
                logChallenge(`guess does not match the XX.YY regexp: ${guess.value}`)
                checker = `**INVALID**: guess ${guess.value} does not match XX.YY format`;
            }
            else {
                let entry = (parsed[1] === '') ? 0 : parsed[1];
                entry += '.';
                entry += (parsed[2] === '') ? 0 : parsed[2].substring(0, 2);
                let considered = parseFloat(entry);
                logChallenge(`value: ${considered} will be considered for entry: ${guess.value}`);
                checker = `**GOOD**: considering ${considered} as the guess`;
            }
        }
        else {
            // Check the number is positive
            if (guess.value < 0) {
                checker = `**INVALID**: negative values are not accepted`;
            }
            else {
                // Check the format matches
                checker = `**GOOD**: considering ${guess.value} as the guess`;
            }
        }
    }

    // Prep message via Mustach template
    const mustache = require("mustache");
    const template = process.env.TEAMS_TEMPLATE || "New row, first colum contains: {{row.0.value}}";
    const message = mustache.render(template, { 'row': row, 'check': checker });

    // Print out to Webex Teams
    const axios = require('axios');
    axios.post(
        'https://api.ciscospark.com/v1/messages',
        {
            roomId: process.env.SPACE_ID,
            markdown: message,
        },
        {
            timeout: DEFAULT_TIMEOUT,
            headers: { 'Authorization': `Bearer ${process.env.BOT_TOKEN}` }
        }
    ).then((response) => {
        switch (response.status) {
            case 200:
                logChallenge('entry successfully posted to Teams');
                break;

            default:
                logChallenge(`entry NOT POSTED to Teams, status code: ${response.status}`);
                break;
        }
    }).catch((err) => {
        logChallenge(`entry NOT POSTED to Teams, err: ${err.message}`);
    })
}


// Starts the Bot service
//
// [WORKAROUND] in some container situation (ie, Cisco Shipped), we need to use an OVERRIDE_PORT to force our bot to start and listen to the port defined in the Dockerfile (ie, EXPOSE), 
// and not the PORT dynamically assigned by the host or scheduler.
var port = process.env.PORT || 8080;
app.listen(port, function () {
    console.log(`SmartSheet webhook listening at: ${port}`);
    console.log("   GET  /   : for health checks");
    console.log("   POST /   : to receive smartsheet payloads");

    // Automatic Webhook creation
    require('./register.js')
});


function checkValid(row) {
    // no challenge
    if (!row[0].value) {
        return false;
    }
    // no guess
    if (!row[4].value) {
        return false;
    }
    // no profile
    if (!row[6].value) {
        return false;
    }
    // no name
    if (!(row[1].value || (row[2].value && row[3].value))) {
        return false;
    }

    return true;
}
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


var express = require("express");
var app = express();

var bodyParser = require("body-parser");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var debug = require("debug")("webhook");

var started = Date.now();
app.route("/")

    // healthcheck
    .get(function (req, res) {
        debug("helthcheck invoked!");
        res.json({
            message: "Congrats, your app is up and running",
            since: new Date(started).toISOString(),
            tip: "Register your app as a Smartsheet WebHook to start receiving events"
        });
    })

    // smartsheet webhook endpoint 
    .post(function (req, res) {
        debug("webhook invoked!");

        // Is it an handshake? (at creation then every 100 calls)
        if (req.headers['smartsheet-hook-challenge']) {
            let challenge = req.headers['smartsheet-hook-challenge'];
            debug(`received handshake challenge: ${challenge}`);
            res.status(200).json({
                smartsheetHookResponse: challenge
            });
            return;
        }

        // is it a Smartsheet Webhook event?
        if ((!req.body) || ('sheet' !== req.body.scope) || (!req.body.events)) {
            console.log("unexpected payload, aborting...");
            res.status(400).json({
                message: "Bad payload for Webhook",
                details: "either the app is not properly configured, or Smartsheet is running a new API version"
            });
            return;
        }

        // [TODO] May be interesting to also test:
        //   - the smartsheet id: req.body.scopeObjectId
        //   - the webhook id: req.body.webhookId

        // Event is ready to be processed, let's send a response to smartsheet without waiting any longer
        // Ack webhook trigger
        res.status(200).json({ message: "fine, the event is being processed by the webhook" });

        // Check for row created events
        req.body.events.forEach(event => {
            if (event && ('created' === event.eventType) && ('row' === event.objectType)) {
                debug('confirmed new row/created event');

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


// Starts the Bot service
//
// [WORKAROUND] in some container situation (ie, Cisco Shipped), we need to use an OVERRIDE_PORT to force our bot to start and listen to the port defined in the Dockerfile (ie, EXPOSE), 
// and not the PORT dynamically assigned by the host or scheduler.
var port = process.env.PORT || 8080;
app.listen(port, function () {
    console.log(`SmartSheet webhook listening at: ${port}`);
    console.log("   GET  /   : for health checks");
    console.log("   POST /   : to receive smartsheet payloads");
});


function processRowCreatedEvent(event) {

    // Fetch row
    debug(`process event: ${event.eventType}`)
    const axios = require('axios');
    const sheetUrl = `https://api.smartsheet.com/2.0/sheets/${process.env.SMARTSHEET_ID}/rows/${event.id}`
    const options = {
        timeout: 3000,
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

function processRowValues(row) {
    debug("new row!");

    // Prep message
    let message = "new row";

    // UPDATE FOR YOUR OWN SMARTSHEET COLUMNS
        /*
        row.foreach((cell, index) => {
            console.log(`${index + 1}: ${cell.value}`)
        });
        */
    // OR USE TEMPLAE
    let mustache = require("mustache");
    var compiled = mustache.render(process.env.TEAMS_TEMPLATE, { 'row': row }); 
    
    // Print out to Webex Teams
    const axios = require('axios');
    axios.post(
        'https://api.ciscospark.com/v1/messages',
        {
            roomId: process.env.SPACE_ID,
            markdown: compiled,
        },
        {
            timeout: 3000,
            headers: { 'Authorization': `Bearer ${process.env.BOT_TOKEN}` }
        }
    );
}
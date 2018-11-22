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

function processRowCreatedEvent(event) {

    // Fetch row
    debug(`process event: ${event.eventType}`)
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

function processRowValues(row) {
    debug("new row!");

    // Prep message via Mustach template
    const mustache = require("mustache");
    const template = process.env.TEAMS_TEMPLATE || "New row, first colum contains: {{row.0.value}}";
    const message = mustache.render(template, { 'row': row });

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
    );
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
});

//
// Automatic Webhook creation
//

// default Webhook URL read from env variable
let public_url = process.env.PUBLIC_URL;

// automatically compute URL in case of Glitch hosting
if (process.env.PROJECT_DOMAIN) {
    public_url = "https://" + process.env.PROJECT_DOMAIN + ".glitch.me";
}

// Create webhook if it does not already exists
if (public_url) {
    // List webhooks for all Smartsheets
    const axios = require('axios');
    axios.get(
        'https://api.smartsheet.com/2.0/webhooks',
        {
            timeout: DEFAULT_TIMEOUT,
            headers: { 'Authorization': `Bearer ${process.env.SMARTSHEET_TOKEN}` }
        })
        .then((response) => {
            let found = false;
            // look for a webhook associated to our smartsheet
            // and created by this code (webhook.ame === "smartsheet-to-webexteams")
            response.data.data.forEach((webhook) => {
                if (('sheet' === webhook.scope) && (process.env.SMARTSHEET_ID == webhook.scopeObjectId) && ('smartsheet-to-webexteams' === webhook.name)) {
                    debug(`found webhook for sheet: ${process.env.SMARTSHEET_ID}`)

                    // Check values, and eventually update the webhook
                    if (webhook.callbackUrl === public_url) {
                        debug(`found webhook with same public URL and name`);

                        if (found) {
                            debug(`looks like several webhook exists for the same spreadsheet, and with same name. Would recommend to remove the latter manually, with id: ${webhook.id}.`)
                        }
                        found = true;

                        if (webhook.status === 'ENABLED') {
                            debug('looks good: the webhook is enabled')
                        }
                        else {
                            // [TODO] Try to enable the webhook instead of existing
                            debug('looks bad: the webhook is not enabled, and current implementation does not fill that gap');
                            
                            // Fail fast
                            console.log('sorry, we found a webhook for this sheet, but it is not enabled.')
                            console.log(`please delete webhook: ${webhook.id} and restart the app.`)
                            process.exit(2);
                        }
                    }
                    else {
                        debug(`found webhook with same name but other public URL :-(`);
                    }
                }
            })

            // if no webhook, create it
            if (!found) {
                debug("creating webhook!")
                axios.post(
                    'https://api.smartsheet.com/2.0/webhooks',
                    {
                        callbackUrl: public_url,
                        events: ["*.*"],
                        name: "smartsheet-to-webexteams",
                        scope: "sheet",
                        scopeObjectId: process.env.SMARTSHEET_ID,
                        "version": "1"
                    },
                    {
                        timeout: DEFAULT_TIMEOUT,
                        headers: { 'Authorization': `Bearer ${process.env.SMARTSHEET_TOKEN}` }
                    })
                    .then((response) => {
                        switch (response.status) {
                            case 200:
                                // [PENDING] Validate the webhook
                                debug('validate the Webhook');

                                axios.put(
                                    `https://api.smartsheet.com/2.0/webhooks/${response.data.result.id}`,
                                    { 
                                        "enabled": true
                                    },
                                    {
                                        timeout: DEFAULT_TIMEOUT,
                                        headers: { 'Authorization': `Bearer ${process.env.SMARTSHEET_TOKEN}` }
                                    })

                                break;

                            default:
                                // unexpected
                                debug(`unexpected status code: ${response.status}`);
                                break;
                        }
                    })
                    .catch((err) => {
                        debug(`unexpected err: ${err.message}`);
                    })
            }
        })
}
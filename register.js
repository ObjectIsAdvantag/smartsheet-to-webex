
// Loggers
const debug = require("debug")("register");
const fine = require("debug")("register:fine");

// Timeout for outgoing request
const DEFAULT_TIMEOUT = 3000; // in seconds

// default Webhook URL read from env variable
let public_url = process.env.PUBLIC_URL;

// automatically compute URL in case of Glitch hosting
if (process.env.PROJECT_DOMAIN) {
    public_url = "https://" + process.env.PROJECT_DOMAIN + ".glitch.me";
}

if (!public_url) {
    debug('no public URL found, will not create the SmartSheet webhook')
}
else {
    // Create webhook if it does not already exists
    debug(`registering a SmartSheet webhook listening at: ${public_url}`)

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
                    debug(`found webhook for your sheet: ${process.env.SMARTSHEET_ID}`)

                    // Check values, and eventually update the webhook
                    if (webhook.callbackUrl === public_url) {
                        debug(`webhook has same public URL and name`);

                        if (found) {
                            debug(`hum, looks like several webhook exists for the same spreadsheet, and with same name. Would recommend to remove the latter manually, with id: ${webhook.id}.`)
                            // [TODO] add help tip with sample CURL command
                        }
                        found = true;

                        if (webhook.status === 'ENABLED') {
                            debug('looks good, the webhook is enabled')
                        }
                        else {
                            // [TODO] Try to enable the webhook instead of existing
                            debug('looks bad: the webhook is not enabled, and current implementation does not fill that gap');

                            // Fail fast
                            console.log('sorry, we found a webhook for this sheet, but it is not enabled.')
                            console.log(`please delete webhook: ${webhook.id} and restart the app. Exiting...`);
                            process.exit(2);
                        }
                    }
                    else {
                        // if a webhook already exists but pointing somewhere else, just raise a warning
                        debug(`WARNING: the webhook with id: ${webhook.id} ties to your sheet but points to another public URL. You may be interested to give a look and remove this webhook entry. Continuing...`);        
                    }
                }
            })

            // if no webhook, create it
            if (!found) {
                debug("no webhook detected, creating new webhook")
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
                                debug(`webhook created with id: ${response.data.result.id}`);
                                debug('now sending PUT request to validate the webhook');

                                axios.put(
                                    `https://api.smartsheet.com/2.0/webhooks/${response.data.result.id}`,
                                    {
                                        "enabled": true
                                    },
                                    {
                                        timeout: DEFAULT_TIMEOUT,
                                        headers: { 'Authorization': `Bearer ${process.env.SMARTSHEET_TOKEN}` }
                                    })
                                    .then((response) => {
                                        switch (response.status) {
                                            case 200:
                                                debug('webhook successfully valided');
                                                break;

                                            default:
                                                debug(`webhook could not be valided, status code: ${response.status}`);

                                                // Fail fast
                                                console.log(`cannot validate webhook for your smartsheet, status: ${response.status}`);
                                                console.log('please try again by restarting this app. Ff validation fails again, please proceed manually');
                                                process.exit(3);
                                        }
                                    })
                                    .catch((err) => {
                                        debug(`webhook could not be valided, err: ${err.message}`);

                                        // Fail fast
                                        console.log('cannot validate webhook for your smartsheet, please try again by restarting this app.');
                                        console.log('if validation fails again, please proceed manually');
                                        process.exit(4);
                                    })
                                break;

                            default:
                                debug(`webhook could not be created, status code: ${response.status}`);

                                // Fail fast
                                console.log('cannot create webhook for your smartsheet, please try again by restarting this app.');
                                console.log('if creation fails again, please proceed manually');
                                process.exit(5);
                        }
                    })
                    .catch((err) => {
                        debug(`webhook could not be created, err: ${err.message}`);

                        // Fail fast
                        console.log('cannot create webhook for your smartsheet, please try again by restarting this app.');
                        console.log('if creation fails again, please proceed manually');
                        process.exit(6);
                    })
                return;
            }

            // if webhook found, announce the great news
            debug("webhook found, all good, continuing...")
        })
        .catch((err) => {
            debug(`cannot list webhooks, err: ${err.message}`)

            // Fail fast
            console.log('!!!sorry, we encountered an ERROR!!!');
            console.log('we could NOT create the Smartsheet webhook for this app to receive notifications as new entries are added to your sheet');
            console.log('please restart the app to try again');
            console.log('if it still fails, please try to create the webhook manually!');
            console.log('exiting...');

            // [TODO] Add instructions to create the webhook manually
            process.exit(10);
        })
}
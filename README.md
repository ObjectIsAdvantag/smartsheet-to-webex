# Smartsheet to Webex Teams

a Node.js webhook that posts messages to Webex Teams as new rows are filled in a SmartSheet

to run this code, please
1. launch the app with a bot token and Teams space identifier
2. create a SmartSheet Webhook
3. validate the SmartSheet Webhook (check the documtend API flow)
3. post new entries via a Smartsheet form ideally


## Launch the SmartSheet to Webex Teams app

For **Mac, Linux and bash users**, open a terminal and type:

```shell
git clone https://github.com/CiscoDevNet/smartsheet-to-webex-teams
cd smartsheet-to-webex-teams
npm install
DEBUG=webhook* BOT_TOKEN=XXXXXXXXX SPACE_ID=YYYYYYYYYYY node webhook.js
```

For **Windows users**, open a command shell and type:

```shell
git clone https://github.com/CiscoDevNet/smartsheet-to-webex-teams
cd smartsheet-to-webex-teams
npm install
set DEBUG=webhook*
set BOT_TOKEN=XXXXXXXXX
set SPACE_ID=YYYYYYYYYYY
node webhook.js
```

**Done, your webhook is live**

Let's hit your app's healthcheck! 
From the command line, type:

```shell
curl -X GET http://localhost:8080
```


## To register your app as a Smartsheet Webhook

Create a Smartsheet API token from your smartsheet account:
- login
- click your avatar, pick "Apps and Integrations..."
- among your Personal Settings, select "API Access"
- click the "Generate new access token" button

Now, let's list your smartsheets and look for the identifier of the smartsheet you want to monitor. From the terminal, run the command below:

```shell
curl -X GET https://api.smartsheet.com/2.0/sheets \
  -H 'Authorization: Bearer qq0w5090qq0w5090qq0w5090' 
```


Finally, create a SmartSheet webhook on the command line by typing:

```shell
curl -X POST https://api.smartsheet.com/2.0/webhooks \
  -H 'Authorization: Bearer qq0w5090qq0w5090qq0w5090' \
  -H 'Content-Type: application/json' \
  -d '{ 
    "callbackUrl": "https://e6174831.ngrok.io",
    "events": ["*.*"],
    "name": "From Postman",
    "scope": "sheet",
    "scopeObjectId" : "6275510532630404",
    "version": "1"
}'
```
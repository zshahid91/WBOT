const puppeteer = require('puppeteer-core');
const _cliProgress = require('cli-progress');
const spintax = require('mel-spintax');
require("./welcome");
var spinner = require("./step");
var utils = require("./utils");
var qrcode = require('qrcode-terminal');
var path = require("path");
var argv = require('yargs').argv;
var rev = require("./detectRev");
var constants = require("./constants");
var configs = require("../bot");
var settings = require('./settings');
var fs = require("fs");
const fetch = require("node-fetch");
const { lt } = require('semver');

//console.log(ps);

//console.log(process.cwd());

async function Main() {

    try {
        //console.log(configs);
        var page;
        await downloadAndStartThings();
        var isLogin = await checkLogin();
        if (!isLogin) {
            await getAndShowQR();
        }
        // if (configs.smartreply.suggestions.length > 0) {
        //     await setupSmartReply();
        // }
        await setupPopup();
        await checkForUpdate();
        console.log("WBOT is ready !! Let those message come.");

    } catch (e) {
        console.error("\nLooks like you got an error. " + e);
        try {
            page.screenshot({ path: path.join(process.cwd(), "error.png") })
        } catch (s) {
            console.error("Can't create shreenshot, X11 not running?. " + s);
        }
        console.warn(e);
        console.error("Don't worry errors are good. They help us improve. A screenshot has already been saved as error.png in current directory. Please mail it on vasani.arpit@gmail.com along with the steps to reproduce it.\n");
        throw e;
    }

    /**
     * If local chrome is not there then this function will download it first. then use it for automation. 
     */
    async function downloadAndStartThings() {
        let botjson = utils.externalInjection("bot.json");
        var appconfig = await utils.externalInjection("bot.json");
        appconfig = JSON.parse(appconfig);
        spinner.start("Downloading chrome\n");
        const browserFetcher = puppeteer.createBrowserFetcher({
            path: process.cwd()
        });
        const progressBar = new _cliProgress.Bar({}, _cliProgress.Presets.shades_grey);
        progressBar.start(100, 0);
        var revNumber = await rev.getRevNumber();
        const revisionInfo = await browserFetcher.download(revNumber, (download, total) => {
            //console.log(download);
            var percentage = (download * 100) / total;
            progressBar.update(percentage);
        });
        progressBar.update(100);
        spinner.stop("Downloading chrome ... done!");
        //console.log(revisionInfo.executablePath);
        spinner.start("Launching Chrome");
        var pptrArgv = [];
        if (argv.proxyURI) {
            pptrArgv.push('--proxy-server=' + argv.proxyURI);
        }
        const extraArguments = Object.assign({});
        extraArguments.userDataDir = constants.DEFAULT_DATA_DIR;
        const browser = await puppeteer.launch({
            executablePath: revisionInfo.executablePath,
            defaultViewport: null,
            headless: appconfig.appconfig.headless,
            userDataDir: path.join(process.cwd(), "ChromeSession"),
            devtools: false,
            args: [...constants.DEFAULT_CHROMIUM_ARGS, ...pptrArgv], ...extraArguments
        });
        spinner.stop("Launching Chrome ... done!");
        if (argv.proxyURI) {
            spinner.info("Using a Proxy Server");
        }
        spinner.start("Opening Whatsapp");
        page = await browser.pages();
        if (page.length > 0) {
            page = page[0];
            page.setBypassCSP(true);
            if (argv.proxyURI) {
                await page.authenticate({ username: argv.username, password: argv.password });
            }
            page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36");

            // page.evaluate(`
            //     window.onload = function () {
            //         // Custom.init();
            //         alert("inject reload function call");
            //     };
            // `);



            await page.goto('https://web.whatsapp.com', {
                waitUntil: 'networkidle0',
                timeout: 0
            });
            // console.log(contents);
            //await injectScripts(page);
            botjson.then((data) => {
                page.evaluate("var intents = " + data);
                //console.log(data);
            }).catch((err) => {
                console.log("there was an error \n" + err);
            });
            spinner.stop("Opening Whatsapp ... done!");
            page.exposeFunction("log", (message) => {
                console.log(message);
            });

            // When the settings file is edited multiple calls are sent to function. This will help
            // to prevent from getting corrupted settings data
            let timeout = 5000;

            // Register a filesystem watcher
            fs.watch(constants.BOT_SETTINGS_FILE, (event, filename) => {
                setTimeout(() => {
                    settings.LoadBotSettings(event, filename, page);
                }, timeout);
            });

            page.exposeFunction("getFile", utils.getFileInBase64);
            page.exposeFunction("saveFile", utils.saveFileFromBase64);
            page.exposeFunction("resolveSpintax", spintax.unspin);
            page.exposeFunction("checkSpam", utils.checkSpam);
            page.exposeFunction("callReloadFunction", callReloadFunction);
        }
    }

    async function callReloadFunction() {
        console.log("ibdex reload call");
    }


    async function injectScripts(page) {
        // return await page.waitForSelector('[data-icon=laptop]')
        return await page.waitForSelector('[data-icon=laptop]', { visible: true })
            .then(async () => {
                var filepath = path.join(__dirname, "WAPI.js");
                await page.addScriptTag({ path: require.resolve(filepath) });
                filepath = path.join(__dirname, "inject.js");
                await page.addScriptTag({ path: require.resolve(filepath) });
                return true;
            })
            .catch(() => {
                console.log("User is not logged in. Waited 30 seconds.");
                return false;
            })
    }

    async function checkLogin() {
        spinner.start("Page is loading");
        //TODO: avoid using delay and make it in a way that it would react to the event. 
        await utils.delay(10000);
        //console.log("loaded");
        var output = await page.evaluate("localStorage['last-wid']");
        var businessOutput = await page.evaluate("localStorage['last-wid-md']");
        // console.log("\n" + output);
        if (output || businessOutput) {
            output = true;
            spinner.stop("Looks like you are already logged in");
            await injectScripts(page);
        } else {
            spinner.info("You are not logged in. Please scan the QR below");
            output = false;
        }
        return output;
    }

    //TODO: add logic to refresh QR.
    async function getAndShowQR() {
        //TODO: avoid using delay and make it in a way that it would react to the event. 
        //await utils.delay(10000);
        var scanme = "img[alt='Scan me!'], canvas";
        await page.waitForSelector(scanme);
        var imageData = await page.evaluate(`document.querySelector("${scanme}").parentElement.getAttribute("data-ref")`);
        //console.log(imageData);
        qrcode.generate(imageData, { small: true });
        spinner.start("Waiting for scan \nKeep in mind that it will expire after few seconds");
        var isLoggedIn = await injectScripts(page);
        while (!isLoggedIn) {
            //console.log("page is loading");
            //TODO: avoid using delay and make it in a way that it would react to the event. 
            await utils.delay(300);
            isLoggedIn = await injectScripts(page);
        }
        if (isLoggedIn) {
            spinner.stop("Looks like you are logged in now");
            //console.log("Welcome, WBOT is up and running");
        }
    }

    async function setupSmartReply() {
        spinner.start("setting up smart reply");
        await page.waitForSelector("#app");
        await page.evaluate(`
            var observer = new MutationObserver((mutations) => {
                for (var mutation of mutations) {
                    // console.log(mutation);
                    if (mutation.addedNodes.length && mutation.addedNodes[0].id === 'main') {
                        //newChat(mutation.addedNodes[0].querySelector('.copyable-text span').innerText);
                        console.log("%cChat changed !!", "font-size:x-large");
                        WAPI.addOptions();
                        WAPI.addSpamCss(event.target);
                        WAPI.addNumberClass();
                    }
                }
            });
            observer.observe(document.querySelector('#app'), { attributes: false, childList: true, subtree: true });

        `);
        await page.evaluate(`
            var css = '.spam-active{ background-color: #8c880c!important; }',
            head = document.head || document.getElementsByTagName('head')[0],
            style = document.createElement('style');
            head.appendChild(style);
            style.appendChild(document.createTextNode(css));
        `);
        spinner.stop("setting up smart reply ... done!");
        page.waitForSelector("#main", { timeout: 0 }).then(async () => {
            await page.exposeFunction("sendMessage", async message => {
                return new Promise(async (resolve, reject) => {
                    // Type message with space to the currently open chat using power of puppeteer 
                    await page.type("#main div.selectable-text[data-tab]", message + " ");
                    if (configs.smartreply.clicktosend) {
                        page.keyboard.press("Enter");
                    }
                });
            });
        });
    }

    async function setupPopup() {
        spinner.start("Setting up the popup");
        await page.waitForSelector("#app");
        await page.evaluate(`
            var observer = new MutationObserver((mutations) => {
                for (var mutation of mutations) {
                    // console.log(mutation);
                    if (mutation.addedNodes.length && mutation.addedNodes[0].id === 'main') {
                        //newChat(mutation.addedNodes[0].querySelector('.copyable-text span').innerText);
                        console.log("%cChat changed !!", "font-size:x-large");
                        WAPI.setupFeaturePage();
                        WAPI.addSpamCss(event.target);
                        WAPI.addNumberClass();
                    }
                }
            });
            observer.observe(document.querySelector('#app'), { attributes: false, childList: true, subtree: true });
        `);
        await page.evaluate(`
            var css = '.spam-active{ background-color: #8c880c!important; }',
            head = document.head || document.getElementsByTagName('head')[0],
            style = document.createElement('style');
            head.appendChild(style);
            style.appendChild(document.createTextNode(css));
        `)
        spinner.stop("Setting up the popup... Completed");
    }

    async function checkForUpdate() {
        spinner.start("Checking for an Update...");
        // Using Github API (https://docs.github.com/en/rest/reference/repos#releases)
        // to get the releases data
        const url = "https://api.github.com/repos/vasani-arpit/WBOT/releases";
        const response = await fetch(url);

        // Storing data in form of JSON
        var data = await response.json();
        var latestVersion = data[0].tag_name;
        var latestVersionLink = `https://github.com/vasani-arpit/WBOT/releases/tag/${latestVersion}`;
        var myVersion = 'v' + require('../package.json').version;

        spinner.stop("Checking for an Update... Completed");

        if (lt(myVersion, latestVersion)) {
            console.log(`An Update is available for you.\nPlease download the latest version ${latestVersion} of WBOT from ${latestVersionLink}`);
        }
    }
}

Main();

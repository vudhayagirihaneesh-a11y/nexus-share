const puppeteer = require('puppeteer');
const fs = require('fs');
(async () => {
    fs.writeFileSync('test_upload.txt', 'Hello world');
    const browser = await puppeteer.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const page1 = await browser.newPage();
    const page2 = await browser.newPage();

    page1.on('console', msg => console.log('PAGE 1:', msg.text()));
    page2.on('console', msg => console.log('PAGE 2:', msg.text()));

    console.log("Loading Sender...");
    await page1.goto('http://localhost:5173', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1000));
    await page1.waitForSelector('#btn-hero-launch', { visible: true });
    await page1.click('#btn-hero-launch');
    await page1.waitForSelector('#btn-role-send', { visible: true });
    await page1.click('#btn-role-send');
    
    console.log("Selecting file...");
    const fileInput = await page1.$('#file-input');
    await fileInput.uploadFile('test_upload.txt');
    
    await page1.waitForSelector('#btn-next-method:not(.hidden)');
    await page1.click('#btn-next-method');
    await page1.click('#btn-method-otp');
    
    await new Promise(r => setTimeout(r, 2000));
    const otpCode = await page1.evaluate(() => document.getElementById('otp-display').textContent);
    console.log("OTP Code Generated:", otpCode);

    console.log("Loading Receiver...");
    await page2.goto('http://localhost:5173', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1000));
    await page2.waitForSelector('#btn-hero-launch', { visible: true });
    await page2.click('#btn-hero-launch');
    await page2.waitForSelector('#btn-role-receive', { visible: true });
    await page2.click('#btn-role-receive');
    await page2.waitForSelector('#btn-method-otp', { visible: true });
    await page2.click('#btn-method-otp');
    await page2.type('#otp-input', otpCode);
    await page2.click('#btn-connect-otp');
    
    await new Promise(r => setTimeout(r, 2000));
    
    const isModalVisible = await page2.evaluate(() => !document.getElementById('permission-modal').classList.contains('hidden'));
    if (isModalVisible) {
        console.log("Receiver accepting transfer...");
        await page2.click('#btn-accept');
    } else {
        console.log("WARNING: Permission modal not shown on receiver!");
    }

    console.log("Waiting 5 seconds for transfer...");
    await new Promise(r => setTimeout(r, 5000));

    const status1 = await page1.evaluate(() => document.getElementById('transfer-heading')?.textContent);
    const status2 = await page2.evaluate(() => document.getElementById('transfer-heading')?.textContent);
    console.log("Sender Final Status:", status1);
    console.log("Receiver Final Status:", status2);

    await browser.close();
})().catch(err => {
    console.error("Test failed with error:", err);
    process.exit(1);
});

async function testJoin() {
    const BOT_SERVICE_URL = 'http://localhost:6767';
    const TEST_URL = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_Y2M1ZGVmOWMtZTMyOC00MjgxLTk1ZjEtZDQ1ZDM5NjY2NWEy%40thread.v2/0?context=%7b%22Tid%22%3a%2248b12b95-fafa-4dd2-b3fc-a40a38506f93%22%2c%22Oid%22%3a%226247141c-1083-4830-82db-6364ecc2e023%22%7d";

    try {
        console.log("Sending join request...");
        const response = await fetch(`${BOT_SERVICE_URL}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: "test-session-123",
                joinUrl: TEST_URL,
                meetingId: "test-meeting-123",
                mode: "bot_recording",
                botName: "Test Bot"
            })
        });

        const data = await response.json();
        console.log("Response:", data);

        // Wait 15 seconds and check status
        console.log("Waiting 15s for status check...");
        setTimeout(async () => {
            const statusRes = await fetch(`${BOT_SERVICE_URL}/status/test-session-123`);
            const statusData = await statusRes.json();
            console.log("Status:", statusData);
        }, 15000);

    } catch (error) {
        console.error("Test failed:", error.message);
    }
}

testJoin();

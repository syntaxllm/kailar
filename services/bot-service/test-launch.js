/**
 * Simple test script to launch bot with a meeting URL
 * Usage: node test-launch.js <meeting-url>
 * Example: node test-launch.js "https://teams.microsoft.com/meet/41278206054034?p=rro0Cr23a8NUSGXfIX"
 */

const BOT_SERVICE_URL = process.env.BOT_SERVICE_URL || 'http://localhost:6767';

async function launchBot(meetingUrl) {
    if (!meetingUrl) {
        console.error('❌ Error: Meeting URL is required');
        console.log('Usage: node test-launch.js <meeting-url>');
        process.exit(1);
    }

    try {
        console.log('🚀 Launching bot...');
        console.log(`   Meeting URL: ${meetingUrl}`);
        
        const response = await fetch(`${BOT_SERVICE_URL}/launch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                joinUrl: meetingUrl,
                botName: 'Skarya bot',
                meetingId: `test_${Date.now()}`
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('✅ Bot launch initiated!');
        console.log(`   Session ID: ${data.sessionId}`);
        console.log(`   Status: ${data.status}`);
        console.log(`   Message: ${data.message}`);
        
        // Poll for status updates
        if (data.sessionId) {
            console.log('\n📊 Monitoring bot status...');
            const checkStatus = async () => {
                try {
                    const statusRes = await fetch(`${BOT_SERVICE_URL}/status/${data.sessionId}`);
                    if (statusRes.ok) {
                        const statusData = await statusRes.json();
                        console.log(`   Status: ${statusData.status}`);
                        
                        if (statusData.status === 'joined' || statusData.status === 'recording') {
                            console.log('✅ Bot successfully joined the meeting!');
                            process.exit(0);
                        } else if (statusData.status === 'error' || statusData.status === 'completed') {
                            console.log(`⚠️  Bot status: ${statusData.status}`);
                            process.exit(0);
                        }
                    }
                } catch (e) {
                    console.error('   Error checking status:', e.message);
                }
            };
            
            // Check status every 3 seconds
            const statusInterval = setInterval(checkStatus, 3000);
            
            // Stop after 2 minutes
            setTimeout(() => {
                clearInterval(statusInterval);
                console.log('\n⏱️  Status check timeout. Bot may still be running.');
                process.exit(0);
            }, 120000);
        }
    } catch (error) {
        console.error('❌ Failed to launch bot:', error.message);
        process.exit(1);
    }
}

// Get meeting URL from command line argument
const meetingUrl = process.argv[2];
launchBot(meetingUrl);

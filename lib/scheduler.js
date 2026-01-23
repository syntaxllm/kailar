import { getScheduledRecordings, deleteScheduledRecording } from './storage-prod.js';
import { requestBotJoin } from './bot-service.js';

let isRunning = false;

/**
 * Poller to check for scheduled meetings that should start now.
 */
export async function tickScheduler() {
    if (isRunning) return;
    isRunning = true;

    try {
        const schedules = await getScheduledRecordings();
        const now = new Date();

        for (const schedule of schedules) {
            const meetingTime = new Date(schedule.start);

            // Join if it's within 5 minutes of start or has already started
            // and isn't too old (e.g., within 30 mins)
            const diffMinutes = (meetingTime - now) / 60000;

            if (diffMinutes <= 2 && diffMinutes >= -30) {
                console.log(`⏰ Scheduler: Joining meeting ${schedule.id} (${schedule.subject})`);

                // Trigger Bot
                await requestBotJoin(schedule.webUrl, {
                    meetingId: schedule.id,
                    mode: 'bot_recording',
                    recordAudio: true
                });

                // Remove from schedule once join is triggered
                await deleteScheduledRecording(schedule.id);
            } else if (diffMinutes < -30) {
                // Cleanup old schedules
                console.log(`⏰ Scheduler: Removing expired schedule ${schedule.id}`);
                await deleteScheduledRecording(schedule.id);
            }
        }
    } catch (err) {
        console.error('⏰ Scheduler Error:', err.message);
    } finally {
        isRunning = false;
    }
}

/**
 * Start the scheduler (for background use)
 */
export function initScheduler() {
    console.log('🚀 skarya.ai Scheduler Initialized');
    // Poll every 60 seconds
    setInterval(tickScheduler, 60000);
}

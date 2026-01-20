import * as msal from '@azure/msal-node';

/**
 * MSAL Configuration
 */
const msalConfig = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
    }
};

const pca = new msal.ConfidentialClientApplication(msalConfig);

/**
 * Generate Authorization URL
 */
export async function getAuthUrl() {
    const authCodeUrlParameters = {
        scopes: [
            "user.read",
            "OnlineMeetings.Read",
            "OnlineMeetingTranscript.Read.All",
            "OnlineMeetingRecording.Read.All",
            "Calendars.Read"
        ],
        redirectUri: process.env.AZURE_REDIRECT_URI,
    };

    return await pca.getAuthCodeUrl(authCodeUrlParameters);
}

/**
 * Exchange Code for Token
 */
export async function getTokenFromCode(code) {
    const tokenRequest = {
        code: code,
        scopes: [
            "user.read",
            "OnlineMeetings.Read",
            "OnlineMeetingTranscript.Read.All",
            "OnlineMeetingRecording.Read.All",
            "Calendars.Read"
        ],
        redirectUri: process.env.AZURE_REDIRECT_URI,
    };

    const response = await pca.acquireTokenByCode(tokenRequest);
    return response;
}

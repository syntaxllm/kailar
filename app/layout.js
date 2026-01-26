import './globals.css';

export const metadata = {
  title: 'Skarya.AI | Intelligent Meeting Assistant',
  description: 'AI-powered meeting recorder and assistant. Capture, transcribe, and analyze your Microsoft Teams meetings automatically.',
  keywords: 'meeting recorder, AI assistant, Microsoft Teams, transcription, meeting notes',
  authors: [{ name: 'Skarya.AI' }],
  themeColor: '#5B5FC7',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  )
}

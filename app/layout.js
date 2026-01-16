import './globals.css';

export const metadata = {
  title: 'MeetingAI Shell',
  description: 'Backend Core Interface',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

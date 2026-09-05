import './globals.css';

export const metadata = {
  title: 'Ferian Finance',
  description: 'Household financial operating system for variable-income families',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

import localFont from 'next/font/local';
const rethink = localFont({ src: '../../fonts/rethink-sans.woff2', variable: '--font-rethink-sans', display: 'swap' });
const mono = localFont({ src: '../../fonts/ibm-plex-mono-400.woff2', variable: '--font-ibm-plex-mono', display: 'swap' });
const doto = localFont({ src: '../../fonts/doto.woff2', variable: '--font-doto', display: 'swap' });
export const dsFontVariables = `${rethink.variable} ${mono.variable} ${doto.variable}`;

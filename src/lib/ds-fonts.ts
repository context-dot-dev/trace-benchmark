import { Doto, Rethink_Sans } from 'next/font/google';

const rethinkSans = Rethink_Sans({ subsets: ['latin'], variable: '--font-rethink-sans' });
const doto = Doto({ subsets: ['latin'], weight: ['800'], variable: '--font-doto' });

export const dsFontVariables = `${rethinkSans.variable} ${doto.variable}`;

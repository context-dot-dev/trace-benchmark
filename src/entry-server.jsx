import React from 'react';
import { renderToString } from 'react-dom/server';
import App from './App';
export function render(summary){return renderToString(<App initialData={summary}/>);}

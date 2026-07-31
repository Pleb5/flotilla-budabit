import { mount } from 'svelte';
import { seedHostThemeFallback } from '@flotilla/ext-shared';
import './app.css';
import App from './App.svelte';

// Seed light/dark from prefers-color-scheme before first paint so a
// light-theme host doesn't flash the dark default (the host's widget:init /
// widget:themeChanged then takes over via watchHostTheme).
seedHostThemeFallback();

const appElement = document.getElementById('app');
if (!appElement) {
  throw new Error('App element not found');
}

const app = mount(App, {
  target: appElement,
});

export default app;

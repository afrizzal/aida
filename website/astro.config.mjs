// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// GitHub Pages PROJECT page: https://afrizzal.github.io/aida
	site: 'https://afrizzal.github.io',
	base: '/aida',
	integrations: [
		starlight({
			title: 'AIDA',
			description: 'The open-source, AI-native helpdesk you can self-host.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/afrizzal/aida' }],
			editLink: {
				baseUrl: 'https://github.com/afrizzal/aida/edit/master/website/',
			},
			sidebar: [
				{ label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
				{ label: 'Configuration', items: [{ autogenerate: { directory: 'configuration' } }] },
				{ label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
				{ label: 'Operations', items: [{ autogenerate: { directory: 'operations' } }] },
				{ label: 'Security', items: [{ autogenerate: { directory: 'security' } }] },
			],
		}),
	],
});

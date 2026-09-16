// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
	// Org root Pages site — served at the domain root, so no `base`.
	site: 'https://motrix-energy.github.io',
	integrations: [
		// astro-mermaid must be listed before starlight so it claims the
		// ```mermaid fences ahead of Starlight's code-block handling. Mermaid
		// is bundled from npm and rendered client-side: no headless browser in
		// CI, and diagram pages lazy-load it.
		mermaid({
			// 'base' is the one mermaid theme that honours themeVariables in
			// full; the variables recreate the brand's dark palette.
			theme: 'base',
			mermaidConfig: {
				themeVariables: {
					darkMode: true,
					fontFamily: "'Archivo', -apple-system, 'Segoe UI', Roboto, sans-serif",
					background: '#0B1E2D',
					primaryColor: '#1B3648',
					primaryTextColor: '#E6EEF2',
					primaryBorderColor: '#244358',
					secondaryColor: '#12293A',
					tertiaryColor: '#12293A',
					lineColor: '#8FA3B0',
					textColor: '#AFC2CD',
				},
			},
		}),
		starlight({
			title: 'Motrix',
			description: 'Documentation for Motrix Edge and Motrix Edge View — a local-first, extensible energy management system.',
			// No `logo`: the SiteTitle override renders the brand lockup
			// (mark + wordmark + kicker) so the wordmark sets in live Archivo.
			favicon: '/favicon.svg',
			customCss: [
				// Fonts first, so --sl-font resolves to a declared face.
				'./src/styles/fonts.css',
				'./src/styles/theme.css',
			],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/Motrix-Energy' },
			],
			editLink: {
				baseUrl: 'https://github.com/Motrix-Energy/Motrix-Energy.github.io/edit/main/',
			},
			components: {
				SiteTitle: './src/components/SiteTitle.astro',
				// Dark-only: force the theme and remove the toggle.
				ThemeProvider: './src/components/ThemeProvider.astro',
				ThemeSelect: './src/components/ThemeSelect.astro',
			},
			expressiveCode: {
				styleOverrides: {
					borderRadius: '0',
					frames: {
						shadowColor: 'transparent',
					},
				},
			},
			head: [
				{ tag: 'meta', attrs: { name: 'theme-color', content: '#0B1E2D' } },
			],
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'What is Motrix?', slug: 'start/what-is-motrix' },
						{ label: 'Prerequisites', slug: 'start/prerequisites' },
						{ label: 'Quickstart', slug: 'start/quickstart' },
						{ label: 'From replay to timeline', slug: 'start/replay-to-timeline' },
					],
				},
				{
					label: 'Understand',
					items: [
						{ label: 'System overview', slug: 'architecture/overview' },
						{ label: 'The plugin system', slug: 'architecture/plugins' },
						{ label: 'Data flow: wire to decision', slug: 'architecture/data-flow' },
						{ label: 'Time, replay and determinism', slug: 'architecture/time-and-replay' },
						{ label: 'Lifecycle and supervision', slug: 'architecture/lifecycle' },
						{ label: 'Security model', slug: 'architecture/security' },
					],
				},
				{
					label: 'Run it',
					items: [
						{ label: 'Configuration', slug: 'operate/configuration' },
						{ label: 'Docker and compose profiles', slug: 'operate/docker' },
						{ label: 'Connecting real hardware', slug: 'operate/hardware' },
						{ label: 'Using the viewer', slug: 'operate/viewer' },
						{ label: 'Troubleshooting', slug: 'operate/troubleshooting' },
					],
				},
				{
					label: 'Contribute',
					items: [
						{ label: 'Contribution workflow', slug: 'contribute/workflow' },
						{ label: 'Build your first connector', slug: 'contribute/your-first-connector' },
						{ label: 'Connector patterns and footguns', slug: 'contribute/connector-patterns' },
						{ label: 'Devices and capabilities', slug: 'contribute/devices' },
						{ label: 'Algorithms', slug: 'contribute/algorithms' },
						{ label: 'Storage backends and services', slug: 'contribute/storage-and-services' },
						{ label: 'Contributing to Edge View', slug: 'contribute/viewer' },
						{ label: 'Changing the storage format', slug: 'contribute/storage-format-changes' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'REST API', slug: 'reference/rest-api' },
						{ label: 'Shipped plugin catalogue', slug: 'reference/plugin-catalog' },
						{ label: 'Storage format 1.0', slug: 'reference/storage-format' },
						{ label: 'Glossary', slug: 'reference/glossary' },
					],
				},
			],
		}),
	],
});

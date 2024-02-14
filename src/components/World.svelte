<style>
	button { color: red; }
</style>
<script>
	import { cell } from '@lifeart/gxt';
	import { Smile } from './pages/page-one/Smile.ts';

	export let prefix = 'hello';

	// export let defaultName = 'Hello World';
	const name = cell(`${prefix} World`);

	const updateName = () => {
		name.value = 'Hi';
	}
</script>

<button 
	class="text-white bg-gray-800 hover:bg-gray-900 focus:outline-none focus:ring-4 focus:ring-gray-300 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 dark:bg-gray-800 dark:hover:bg-gray-700 dark:focus:ring-gray-700 dark:border-gray-700" 
	on:click={updateName}>{name} <slot /> <Smile /></button>

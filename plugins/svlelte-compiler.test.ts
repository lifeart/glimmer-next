import { expect, test, describe } from 'vitest';
import { compile } from './svelte-compiler';

let sample1 = `
<div id="12" name={3+2} label="1{2}"></div>
<button disabled={!clickable}>...</button>
<button disabled>can't touch this</button>
<input type=checkbox />
<input required={false} placeholder="This input field is not required" />
<div title={null}>This div has no title attribute</div>
<button disabled="{number !== 42}">...</button>
<button {disabled}>...</button>
<Widget foo={bar} answer={42} text="hello" />
<p>{a} + {b} = {a + b}.</p>
<div>{(/^[A-Za-z ]+$/).test(value) ? x : y}</div>
{#if expression}...{:else}...{/if}
{#if answer === 42}
	<p>what was the question?</p>
{/if}
-----
{#if porridge.temperature > 100}
	<p>too hot!</p>
{:else if 80 > porridge.temperature}
	<p>too cold!</p>
{:else}
	<p>just right!</p>
{/if}
---
{#each expression as name}...{/each}

<ul>
	{#each items as item}
		<li>{item.name} x {item.qty}</li>
	{/each}
</ul>


{#each items as item, i}
	<li>{i + 1}: {item.name} x {item.qty}</li>
{/each}

{#each items as item (item.id)}
	<li>{item.name} x {item.qty}</li>
{/each}

{#each items as item, i (item.id)}
	<li>{i + 1}: {item.name} x {item.qty}</li>
{/each}

<MyComponent {...rest} />

<button on:click={handleClick}>
	count: {count}
</button>

<div class="name"></div>
<div class={isActive ? 'active' : ''} >...</div>
<div class:active={isActive}>...</div>
<div class:active class:inactive={!active} class:isAdmin>...</div>
<div style:color={myColor}>...</div>

<a href="page/{p}">page {p}</a>

<slot name="item" {item} />

<FancyList>
  <p slot="footer">Copyright (c) 2019 Svelte Industries</p>
</FancyList>
`;

let sample2 = `<script>
const name = 'Hello World';
</script>

<div>{name}</div>`;

let sample3 = `
<input {...$$restProps} />
`;

describe('compiler', () => {
  test('compile sample case #1', () => {
    const result = compile(sample1);
    expect(result.code).toMatchSnapshot();
  });
  test('compile sample case #2', () => {
    const result = compile(sample2);
    expect(result.code).toMatchSnapshot();
  });
  test('compile sample case #3', () => {
    const result = compile(sample3);
    expect(result.code).toMatchSnapshot();
  });
});

import { cell, formula } from '@/utils/reactive';

const time = cell(Date.now(), 'time');

const timeInterval = setInterval(() => {
  time.value = Date.now();
}, 1000);

const current = formula(() => {
  return new Date(time.value).toLocaleTimeString();
});

<template>
  <textarea>{{current}}</textarea>
</template>

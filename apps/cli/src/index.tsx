#!/usr/bin/env node
import { Command } from 'commander';
import { ALLAMA_VERSION } from '@allama/core';

const program = new Command()
  .name('allama')
  .description('A development secretary that reports, consults, and finishes the job.')
  .version(ALLAMA_VERSION);

program.action(() => {
  program.help();
});

await program.parseAsync();

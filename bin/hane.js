#!/usr/bin/env node
import { runCli } from '../src/cli/main.js';

process.on('SIGINT', () => process.exit(130));
process.exitCode = await runCli({ argv: process.argv.slice(2) });

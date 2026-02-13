import { registerAs } from '@nestjs/config';

export default registerAs('ollama', () => ({
  url: process.env.OLLAMA_URL || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'llama3.2:1b',
  timeout: parseInt(process.env.OLLAMA_TIMEOUT || '30000', 10),
  enabled: process.env.OLLAMA_ENABLED !== 'false',   // default ON
}));

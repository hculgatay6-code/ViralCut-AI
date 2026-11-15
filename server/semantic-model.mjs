import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const semanticAssets = {
  'model_uint8.onnx': 'ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1',
  'tokenizer.json': '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
  'tokenizer_config.json': 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
}
const directory = () => process.env.VIRALCUT_SEMANTIC_MODEL ?? join(process.env.LOCALAPPDATA ?? homedir(), 'ViralCutAI', 'semantic-e5-small')

export async function semanticStamp() {
  const folder = directory()
  return [folder, ...await Promise.all(Object.keys(semanticAssets).map(name => stat(join(folder, name), { bigint: true })
    .then(info => [info.ino, info.size, info.ctimeNs, info.mtimeNs].join(':'), () => 'missing')))].join('\0')
}

export async function loadSemanticModel() {
  const paths = {}
  for (const [name, expected] of Object.entries(semanticAssets)) {
    const path = join(directory(), name)
    const hash = createHash('sha256')
    for await (const data of createReadStream(path)) hash.update(data)
    if (hash.digest('hex') !== expected) throw new Error('modelIntegrity')
    paths[name] = path
  }
  const [{ InferenceSession, Tensor }, { Tokenizer }, tokenizer, configuration] = await Promise.all([
    import('onnxruntime-node'), import('@huggingface/tokenizers'),
    readFile(paths['tokenizer.json'], 'utf8'), readFile(paths['tokenizer_config.json'], 'utf8'),
  ])
  const encoder = new Tokenizer(JSON.parse(tokenizer), JSON.parse(configuration))
  const session = await InferenceSession.create(paths['model_uint8.onnx'], {
    executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1,
    enableCpuMemArena: false, enableMemPattern: false,
  })
  return async texts => {
    const rows = texts.map(text => encoder.encode('query: ' + text).ids)
    const width = Math.min(160, Math.max(...rows.map(row => row.length)))
    const ids = new BigInt64Array(rows.length * width).fill(1n)
    const mask = new BigInt64Array(ids.length)
    for (const [row, sequence] of rows.entries()) {
      const length = Math.min(width, sequence.length)
      for (let column = 0; column < length; column++) {
        const index = row * width + column
        ids[index] = column === width - 1 && sequence.length > width ? 2n : BigInt(sequence[column])
        mask[index] = 1n
      }
    }
    const dims = [rows.length, width]
    const inputs = { input_ids: new Tensor('int64', ids, dims), attention_mask: new Tensor('int64', mask, dims) }
    if (session.inputNames.includes('token_type_ids')) inputs.token_type_ids = new Tensor('int64', new BigInt64Array(ids.length), dims)
    const result = await session.run(inputs)
    const output = result.last_hidden_state ?? result[session.outputNames[0]]
    const dimension = output?.dims[2]
    if (dimension !== 384 || output.dims[1] !== width) throw new Error('modelOutput')
    return rows.map((sequence, row) => {
      const vector = new Float32Array(dimension)
      for (let token = 0; token < Math.min(width, sequence.length); token++) {
        const offset = (row * width + token) * dimension
        for (let i = 0; i < dimension; i++) vector[i] += output.data[offset + i]
      }
      const norm = Math.hypot(...vector)
      return vector.map(value => value / Math.max(norm, 1e-8))
    })
  }
}

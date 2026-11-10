/** Generate documentation from the server's registered handler types, without running handlers. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { taskCreateRequestSchema } from '../src/shared/schemas/add-task.ts'
import {
  removeTasksPayloadSchema,
  taskIdsPayloadSchema,
} from '../src/shared/schemas/bulk-task-command.ts'
import { removeTaskPayloadSchema } from '../src/shared/schemas/remove-task.ts'

const compilerIndex = process.argv.indexOf('--compiler')
const compiler =
  compilerIndex >= 0 ? process.argv[compilerIndex + 1] : 'typescript'
if (!compiler)
  throw new Error('--compiler requires a classic TypeScript compiler module')
const imported = await import(
  compiler === 'typescript'
    ? compiler
    : pathToFileURL(path.resolve(compiler)).href
)
const ts = imported.default ?? imported
if (!ts.sys)
  throw new Error(
    'Documentation generation requires the classic TypeScript 5.9 compiler API. Pass --compiler <typescript/lib/typescript.js>; the native project type checker remains unchanged.'
  )

const root = process.cwd()
const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')
if (!configPath) throw new Error('tsconfig.json not found')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const program = ts.createProgram(parsed.fileNames, {
  ...parsed.options,
  noEmit: true,
})
if (program.getSyntacticDiagnostics().length)
  throw new Error(
    'The documentation compiler cannot parse this source revision'
  )
const checker = program.getTypeChecker()
const schemas = {}
const assigned = new Map()
let nextId = 0
const flags = ts.TypeFlags
function typeSchema(type, depth = 0) {
  if (!type || depth > 20)
    return {
      description: 'Native nested type; see the same-version source contract.',
    }
  const text = checker.typeToString(type).replace(/import\("[^"]*"\)\./g, '')
  if (type.flags & (flags.Any | flags.Unknown | flags.Never))
    return {
      description: `Declared native type: ${text}; no narrower JSON shape is promised.`,
    }
  if (type.flags & (flags.Undefined | flags.Void))
    return {
      description:
        'No application payload; inspect HTTP status and Content-Type.',
    }
  if (type.isUnion())
    return {
      anyOf: type.types
        .filter((t) => !(t.flags & flags.Undefined))
        .map((t) => typeSchema(t, depth + 1)),
    }
  if (type.flags & flags.StringLiteral)
    return { type: 'string', const: type.value }
  if (type.flags & flags.NumberLiteral)
    return { type: 'number', const: type.value }
  if (type.flags & flags.BooleanLiteral)
    return { type: 'boolean', const: type.intrinsicName === 'true' }
  if (type.flags & flags.StringLike) return { type: 'string' }
  if (type.flags & flags.NumberLike) return { type: 'number' }
  if (type.flags & flags.BooleanLike) return { type: 'boolean' }
  if (type.flags & flags.Null) return { type: 'null' }
  if (checker.isArrayType(type))
    return {
      type: 'array',
      items: typeSchema(checker.getTypeArguments(type)[0], depth + 1),
    }
  if (checker.isTupleType(type))
    return {
      type: 'array',
      prefixItems: checker
        .getTypeArguments(type)
        .map((t) => typeSchema(t, depth + 1)),
    }
  if (type.symbol?.getName() === 'Date')
    return { type: 'string', format: 'date-time' }
  if (type.symbol?.getName() === 'Uint8Array')
    return {
      description:
        'Native byte array; browser HTTP callers use the documented Base64 payload instead of a server path.',
    }
  if (assigned.has(type))
    return { $ref: `#/components/schemas/${assigned.get(type)}` }
  const properties = checker.getPropertiesOfType(type)
  if (!properties.length)
    return {
      type: 'object',
      additionalProperties: true,
      description: `Native ${text}`,
    }
  const name = `Native${++nextId}`
  assigned.set(type, name)
  const schema = {
    type: 'object',
    title: text,
    properties: {},
    required: [],
    additionalProperties: true,
  }
  schemas[name] = schema
  for (const property of properties) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0]
    if (!declaration || property.flags & ts.SymbolFlags.Method) continue
    schema.properties[property.name] = typeSchema(
      checker.getTypeOfSymbolAtLocation(property, declaration),
      depth + 1
    )
    if (!(property.flags & ts.SymbolFlags.Optional))
      schema.required.push(property.name)
  }
  const index = checker.getIndexTypeOfType(type, ts.IndexKind.String)
  if (index) schema.additionalProperties = typeSchema(index, depth + 1)
  return { $ref: `#/components/schemas/${name}` }
}
const protocolSource = fs.readFileSync(
  path.join(root, 'src/shared/protocol/errors.ts'),
  'utf8'
)
const protocolVersion = protocolSource.match(
  /PROTOCOL_ENVELOPE_VERSION = '([^']+)'/
)?.[1]
if (!protocolVersion)
  throw new Error('Missing native protocol envelope version')
const argumentSchemas = {
  'command:createTask': taskCreateRequestSchema,
  'command:removeTask': removeTaskPayloadSchema,
  'command:pauseTasks': taskIdsPayloadSchema,
  'command:resumeTasks': taskIdsPayloadSchema,
  'command:removeTasks': removeTasksPayloadSchema,
}
const paths = {}
const native = []
for (const [kind, filename] of [
  ['command', 'commands.ts'],
  ['query', 'queries.ts'],
]) {
  const file = program.getSourceFile(
    path.join(root, 'src/server/ipc', filename)
  )
  if (!file) throw new Error(`Missing server ${filename}`)
  function visit(node) {
    if (ts.isPropertyAssignment(node) && ts.isComputedPropertyName(node.name)) {
      const value = checker.getTypeAtLocation(node.name.expression)
      if (value.isStringLiteral()) {
        const channel = value.value
        if (channel.startsWith(`${kind}:`)) {
          const signature = checker.getSignaturesOfType(
            checker.getTypeAtLocation(node.initializer),
            ts.SignatureKind.Call
          )[0]
          if (!signature)
            throw new Error(`Missing handler signature: ${channel}`)
          const parameters = signature.getParameters().map((parameter) => {
            const declaration =
              parameter.valueDeclaration ?? parameter.declarations?.[0]
            return {
              name: parameter.name,
              optional: Boolean(
                declaration?.questionToken ||
                  declaration?.initializer ||
                  declaration?.dotDotDotToken
              ),
              rest: Boolean(declaration?.dotDotDotToken),
              schema: typeSchema(
                checker.getTypeOfSymbolAtLocation(
                  parameter,
                  declaration ?? node
                )
              ),
            }
          })
          if (argumentSchemas[channel] && parameters.length)
            parameters[0].schema = z.toJSONSchema(argumentSchemas[channel], {
              io: 'input',
              unrepresentable: 'any',
            })
          const returned = checker.getReturnTypeOfSignature(signature)
          const resultType =
            checker.getPromisedTypeOfPromise(returned) ?? returned
          const noBody = Boolean(
            resultType.flags & (flags.Void | flags.Undefined)
          )
          let result = typeSchema(resultType)
          if (channel === 'query:getTaskInspectorActivity')
            result = {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    protocol: { const: protocolVersion },
                    ok: { const: true },
                    value: result,
                  },
                  required: ['protocol', 'ok', 'value'],
                },
                {
                  type: 'object',
                  properties: {
                    protocol: { const: protocolVersion },
                    ok: { const: false },
                    error: {
                      type: 'object',
                      properties: {
                        code: { type: 'string' },
                        message: { type: 'string' },
                      },
                      required: ['code', 'message'],
                    },
                  },
                  required: ['protocol', 'ok', 'error'],
                },
              ],
            }
          const fixed = parameters.filter((p) => !p.rest)
          const rest = parameters.find((p) => p.rest)
          const argumentsSchema = {
            type: 'array',
            prefixItems: fixed.map((p) => ({ ...p.schema, title: p.name })),
            minItems: fixed.filter((p) => !p.optional).length,
            ...(rest
              ? { items: rest.schema.items ?? rest.schema }
              : { maxItems: fixed.length }),
          }
          const source = `src/server/ipc/${filename}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
          const operation = {
            summary: channel,
            description: `Native server control-plane handler, protected by the VOS gateway. Arguments are positional in args. Source: ${source}. TypeScript types describe serialization shape, not all Zod refinements or engine support; the workflow guide documents those boundaries.`,
            security: [{ VOSBearer: [] }, { VOSSession: [] }],
            requestBody: {
              required: argumentsSchema.minItems > 0,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { args: argumentsSchema },
                    required: argumentsSchema.minItems > 0 ? ['args'] : [],
                  },
                },
              },
            },
            responses: {
              200: {
                description:
                  'Native method result; this is not a universal result envelope. Task Inspector Activity uses its documented protocol envelope instead.',
                ...(noBody
                  ? {}
                  : { content: { 'application/json': { schema: result } } }),
              },
              default: {
                description:
                  'Check HTTP status and error body; unknown channel404, invalid identity401, handler failure500. Native structured results can report a business failure even on200.',
              },
            },
          }
          paths[`/rpc/${kind}/${channel}`] = { post: operation }
          native.push({ channel, parameters, source })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
}
for (const channel of [
  'command:createTask',
  'command:removeTask',
  'query:listTasks',
])
  if (!native.some((item) => item.channel === channel))
    throw new Error(`Missing core handler ${channel}`)
if (native.length < 50) throw new Error('Incomplete native handler coverage')
function object(properties, required = Object.keys(properties)) {
  return { type: 'object', properties, required }
}
const string = { type: 'string' }
const boolean = { type: 'boolean' }
const user = object({ username: string, namespace: string })
const auth = object({ authenticated: boolean, user }, ['authenticated'])
function http(method, route, description, response, body, isPublic = false) {
  paths[route] ??= {}
  paths[route][method] = {
    summary: description,
    security: isPublic ? [] : [{ VOSBearer: [] }, { VOSSession: [] }],
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: body } },
          },
        }
      : {}),
    responses: {
      200: {
        description,
        content: { 'application/json': { schema: response } },
      },
      default: {
        description:
          'VOS gateway errors are JSON error strings. Check identity401, origin403, proxy502 and runtime error500; do not infer success from SPA HTML.',
      },
    },
  }
}
http(
  'get',
  '/healthz',
  'Outer VOS gateway health; does not start a user engine',
  object({ ok: { const: true } }),
  undefined,
  true
)
http(
  'get',
  '/api/vos/auth/session',
  'Local cookie-session status; a Bearer-only caller may still see authenticated=false',
  object(
    {
      enabled: boolean,
      authenticated: boolean,
      user,
      clientId: string,
      scope: string,
    },
    ['enabled', 'authenticated', 'clientId', 'scope']
  ),
  undefined,
  true
)
http(
  'post',
  '/api/vos/auth/login',
  'Verify VOS token and set an HttpOnly scoped session cookie; matching Origin header required',
  auth,
  object({ access_token: { type: 'string', writeOnly: true } }),
  true
)
http(
  'post',
  '/api/vos/auth/logout',
  'Clear outer VOS cookie session; matching Origin required',
  object({ authenticated: { const: false } }),
  undefined,
  true
)
for (const route of ['/api/vos/auth/login', '/api/vos/auth/logout'])
  paths[route].post.parameters = [
    {
      in: 'header',
      name: 'Origin',
      required: true,
      schema: string,
      description: 'Must have the same host as the HTTP Host header',
    },
  ]
http(
  'get',
  '/api/diagnostics',
  'Current user child-runtime diagnostics, native evolving object',
  { type: 'object', additionalProperties: true }
)
for (const action of ['pause-all', 'resume-all'])
  http(
    'post',
    `/api/tasks/${action}`,
    'Current user task bulk action, not a whole-host operation',
    object({ ok: boolean })
  )
paths['/api/plugins/uploads'] = {
  post: {
    summary: 'Stage a plugin package; this does not approve or install it',
    security: [{ VOSBearer: [] }, { VOSSession: [] }],
    parameters: [
      {
        in: 'header',
        name: 'X-Motrix-File-Name',
        required: true,
        schema: string,
        description: 'URL-encoded .moext filename',
      },
      {
        in: 'header',
        name: 'X-Motrix-File-Sha256',
        required: false,
        schema: string,
        description:
          'Optional claimed hash; the server computes and verifies the retained digest',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/vnd.motrix.moext': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    },
    responses: {
      201: {
        description:
          'Native staged upload reference; default retention is one hour and later installation consumes it',
        content: {
          'application/json': {
            schema: object({ uploadId: string, fileHash: string }),
          },
        },
      },
      400: {
        description: 'Invalid file name/hash/package or upload quota',
        content: { 'application/json': { schema: object({ error: string }) } },
      },
      413: { description: 'Exceeds native 5 MiB body limit' },
    },
  },
}
fs.mkdirSync(path.join(root, 'public'), { recursive: true })
fs.writeFileSync(
  path.join(root, 'public/vos-api-contract.json'),
  `${JSON.stringify(
    {
      openapi: '3.1.0',
      info: {
        title: 'V-Motrix VOS native control-plane contracts',
        version: JSON.parse(
          fs.readFileSync(path.join(root, 'package.json'), 'utf8')
        ).version,
      },
      servers: [{ url: '.' }],
      components: {
        securitySchemes: {
          VOSBearer: {
            type: 'http',
            scheme: 'bearer',
            description:
              'VOS identity at the outer gateway; not an upstream operator or bridge agent key.',
          },
          VOSSession: {
            type: 'apiKey',
            in: 'cookie',
            name: 'v_motrix_session',
            description:
              'Established same-origin VOS app cookie; sliding 12-hour expiry.',
          },
        },
        schemas,
      },
      paths,
    },
    null,
    2
  )}\n`
)
const formatted = spawnSync(
  process.execPath,
  [
    'node_modules/@biomejs/biome/bin/biome',
    'format',
    '--write',
    'public/vos-api-contract.json',
  ],
  { cwd: root, stdio: 'inherit' }
)
if (formatted.status !== 0)
  throw new Error('Could not format generated API reference')
console.log(
  `Documented ${native.length} native server handlers, ${Object.keys(schemas).length} shared type shapes`
)

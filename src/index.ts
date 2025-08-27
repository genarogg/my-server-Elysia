import { Elysia } from "elysia";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyCaching from '@fastify/caching';

// Dependencias de GraphQL (inline del archivo que me compartiste)
import { ApolloServer } from "@apollo/server";
import { fastifyApolloHandler } from "@as-integrations/fastify";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import depthLimit from "graphql-depth-limit";
import { processRequest } from "graphql-upload-minimal";

// Plugin de cachin
const caching = (server: FastifyInstance) => {
  return server.register(fastifyCaching, {
    privacy: fastifyCaching.privacy.PUBLIC,
    expiresIn: 3600
  });
}

// GraphQL Schema y Resolvers (copiados de tu archivo)
const typeDefs = `#graphql
    type Query {
        hello: String
        helloWithName(name: String): String
        currentTime: String
    }

    type Mutation {
        sayGoodbye(name: String): String
    }
`;

const resolvers = {
    Query: {
        hello: () => {
            return "¡Hola Mundo desde GraphQL!";
        },
        helloWithName: (_: any, { name }: { name?: string }) => {
            if (name) {
                return `¡Hola ${name}! Bienvenido a GraphQL`;
            }
            return "¡Hola! Por favor proporciona tu nombre";
        },
        currentTime: () => {
            return new Date().toISOString();
        },
    },
    Mutation: {
        sayGoodbye: (_: any, { name }: { name?: string }) => {
            if (name) {
                return `¡Adiós ${name}! Que tengas un buen día`;
            }
            return "¡Adiós! Que tengas un buen día";
        },
    },
};

// Extender los tipos de FastifyRequest
declare module "fastify" {
    interface FastifyRequest {
        user?: any;
    }
}

interface GraphQLContext {
    req: FastifyRequest;
    user?: any;
}

// Función para configurar GraphQL (inline)
const setupGraphQL = async (server: FastifyInstance) => {
    console.log('📦 Setting up Apollo GraphQL...');
    
    // Crear Apollo Server
    const apollo = new ApolloServer({
        typeDefs,
        resolvers,
        introspection: true,
        csrfPrevention: false,
        validationRules: [depthLimit(10)],
        plugins: [
            ApolloServerPluginLandingPageLocalDefault({ embed: true }),
            ApolloServerPluginDrainHttpServer({ httpServer: server.server }),
        ],
        formatError: (formattedError, error) => {
            console.error("GraphQL Error:", error);
            if (process.env.NODE_ENV === "development") {
                return formattedError;
            }
            return {
                message: formattedError.message,
                code: formattedError.extensions?.code,
                path: formattedError.path,
            };
        },
    });

    // Inicializar Apollo Server
    await apollo.start();
    console.log('📦 Apollo Server started');

    // Hook para file uploads
    server.addHook(
        "preHandler",
        async (request: FastifyRequest, reply: FastifyReply) => {
            if (request.url === "/graphql" || request.url.startsWith("/graphql?")) {
                if (
                    request.method === "POST" &&
                    request.headers["content-type"] &&
                    request.headers["content-type"].includes("multipart/form-data")
                ) {
                    try {
                        (request as any).body = await processRequest(
                            request.raw,
                            reply.raw
                        );
                    } catch (error: any) {
                        server.log.error("Error processing file upload:", error);
                        await reply.code(400).send({
                            error: "Error processing file upload",
                            details: process.env.NODE_ENV === "development" ? error.message : undefined,
                        });
                        return;
                    }
                }
            }
        }
    );

    // Registrar la ruta de GraphQL
    server.route({
        url: "/graphql",
        method: ["GET", "POST", "OPTIONS"],
        handler: fastifyApolloHandler(apollo, {
            context: async (request: FastifyRequest): Promise<GraphQLContext> => {
                return {
                    req: request,
                    user: request.user || null,
                };
            },
        }),
    });

    // Ruta de health check
    server.route({
        method: "GET",
        url: "/graphql/health",
        handler: async () => {
            return {
                status: "ok",
                service: "graphql",
                timestamp: new Date().toISOString(),
            };
        },
    });

    console.log('📦 GraphQL routes registered');
    return server;
};

const fastify = Fastify({
  logger: true,
  disableRequestLogging: true
});

// Registrar plugins
const registerPlugins = async () => {
  try {
    console.log('📦 Starting Fastify plugin registration...');
    
    // Registrar caching
    await caching(fastify);
    console.log('✅ Caching plugin registered');
    
    // Registrar Apollo GraphQL inline
    await setupGraphQL(fastify);
    console.log('✅ Apollo GraphQL plugin registered');
    
    // Esperar un momento para que todo se registre
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mostrar todas las rutas registradas
    console.log('\n📦 All registered Fastify routes:');
    try {
      const routes = fastify.printRoutes();
      console.log(routes);
    } catch (e) {
      console.log('📦 printRoutes not available');
    }
    
    // Verificar si podemos hacer una prueba directa a Fastify
    console.log('\n📦 Testing Fastify directly...');
    try {
      const testResponse = await fastify.inject({
        method: 'GET',
        url: '/graphql'
      });
      console.log(`📦 Direct Fastify /graphql GET test: ${testResponse.statusCode}`);
      if (testResponse.statusCode === 200) {
        console.log(`📦 GraphQL Playground should be available!`);
      }
    } catch (testError) {
      console.log(`📦 Direct Fastify GET test error:`, testError.message);
    }
    
    // Probar POST también
    try {
      const testPostResponse = await fastify.inject({
        method: 'POST',
        url: '/graphql',
        payload: { query: '{ hello }' },
        headers: { 'content-type': 'application/json' }
      });
      console.log(`📦 Direct Fastify /graphql POST test: ${testPostResponse.statusCode}`);
      console.log(`📦 POST Response: ${testPostResponse.payload}`);
    } catch (testError) {
      console.log(`📦 Direct Fastify POST test error:`, testError.message);
    }
    
    console.log('✅ All Fastify plugins registered successfully\n');
  } catch (error) {
    console.error('❌ Error registering plugins:', error);
    throw error;
  }
};

// Registrar rutas regulares de Fastify
fastify.get('/fastify', async (request, reply) => {
  console.log('Fastify route /fastify hit');
  reply.header('Cache-Control', 'public, max-age=3600');
  
  return {
    message: 'Hello from Fastify with Caching!',
    server: 'Fastify',
    path: request.url,
    timestamp: new Date().toISOString(),
    cached: true
  };
});

fastify.get('/fastify/users', async (request, reply) => {
  console.log('Fastify route /fastify/users hit');
  reply.header('Cache-Control', 'public, max-age=1800');
  
  return {
    users: [
      { id: 1, name: 'Alice Johnson', role: 'admin' },
      { id: 2, name: 'Bob Wilson', role: 'user' },
      { id: 3, name: 'Charlie Brown', role: 'moderator' }
    ],
    server: 'Fastify',
    total: 3,
    cached: true
  };
});

fastify.get('/fastify/health', async (request, reply) => {
  reply.header('Cache-Control', 'public, max-age=60');
  
  return {
    status: 'healthy',
    server: 'Fastify',
    uptime: process.uptime(),
    version: process.version,
    cached: true
  };
});

// Función adaptadora mejorada
async function handleFastifyRoute(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toLowerCase();
  const path = url.pathname;
  
  console.log(`\n📦 Handling ${method.toUpperCase()} ${path} with Fastify`);
  
  try {
    let payload = null;
    
    // Parsear body para métodos que lo requieren
    if (['post', 'put', 'patch'].includes(method)) {
      try {
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          payload = await request.json();
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const text = await request.text();
          payload = Object.fromEntries(new URLSearchParams(text));
        } else {
          payload = await request.text();
        }
      } catch (error) {
        payload = {};
      }
    }
    
    // Usar inject de Fastify
    const response = await fastify.inject({
      method: method.toUpperCase(),
      url: path + url.search,
      headers: Object.fromEntries(request.headers.entries()),
      payload: payload
    });
    
    console.log(`📦 Fastify response: ${response.statusCode}`);
    
    // Convertir respuesta
    const responseHeaders: Record<string, string> = {};
    if (response.headers) {
      Object.entries(response.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          responseHeaders[key] = value;
        } else if (Array.isArray(value)) {
          responseHeaders[key] = value.join(', ');
        }
      });
    }
    
    return new Response(response.payload, {
      status: response.statusCode,
      headers: responseHeaders
    });
    
  } catch (error) {
    console.error('📦 Fastify handling error:', error);
    return Response.json({
      error: 'Fastify route handling failed',
      details: error.message,
      path: path,
      method: method.toUpperCase()
    }, { status: 500 });
  }
}

// Inicializar servidor
const initializeServer = async () => {
  await registerPlugins();

  const app = new Elysia()
    .get("/", () => ({
      message: "🦊 Elysia + Fastify + GraphQL Integration",
      available_routes: {
        elysia: ["/"],
        fastify: ["/fastify", "/fastify/users", "/fastify/health"],
        graphql: ["/graphql", "/graphql/health"]
      },
      instructions: "Visit /graphql for GraphQL Playground"
    }))
    
    .all("/graphql", async ({ request }) => {
      console.log(`🦊 Elysia GraphQL route hit: ${request.method} ${request.url}`);
      return await handleFastifyRoute(request);
    })
    
    .get("/graphql/health", async ({ request }) => {
      console.log(`🦊 Elysia GraphQL health route hit`);
      return await handleFastifyRoute(request);
    })
    
    .all("/fastify*", async ({ request }) => {
      const url = new URL(request.url);
      console.log(`🦊 Elysia routing to Fastify: ${request.method} ${url.pathname}`);
      return await handleFastifyRoute(request);
    })
    
    .listen(3000);

  console.log(`
🚀 Elysia + Fastify + GraphQL Integration running at ${app.server?.hostname}:${app.server?.port}

=== Available Routes ===

🦊 Elysia Native:
- GET  /                  -> Route info and status

📦 Fastify Integrated:
- GET  /fastify           -> Fastify welcome
- GET  /fastify/users     -> Users list  
- GET  /fastify/health    -> Health check

🚀 GraphQL Integrated:
- GET  /graphql           -> GraphQL Playground
- POST /graphql           -> GraphQL API endpoint  
- GET  /graphql/health    -> GraphQL health check

=== Test Commands ===

# Basic connectivity
curl http://localhost:3000/

# GraphQL tests
curl http://localhost:3000/graphql/health
curl http://localhost:3000/graphql

# GraphQL query
curl -X POST http://localhost:3000/graphql \\
     -H "Content-Type: application/json" \\
     -d '{"query":"{ hello }"}'

# GraphQL query with name
curl -X POST http://localhost:3000/graphql \\
     -H "Content-Type: application/json" \\
     -d '{"query":"{ helloWithName(name: \\"Juan\\") }"}'

=== GraphQL Qeries Available ===
- { hello }
- { helloWithName(name: "YourName") }  
- { currentTime }
- mutation { sayGoodbye(name: "YourName") }
`);
};

initializeServer().catch(console.error);
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ApolloServer } from "@apollo/server";
import { fastifyApolloHandler } from "@as-integrations/fastify";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import depthLimit from "graphql-depth-limit";
import { processRequest } from "graphql-upload-minimal";

// Schema de GraphQL simple para pruebas
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

// Resolvers para el schema
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

// Extender los tipos de FastifyRequest para incluir propiedades adicionales
declare module "fastify" {
    interface FastifyRequest {
        user?: any;
    }
}

// Definir tipos para el contexto
interface GraphQLContext {
    req: FastifyRequest;
    user?: any;
}

// Crear la instancia de Apollo Server con configuraciones avanzadas
const createApolloServer = (server: FastifyInstance) => {
    return new ApolloServer({
        typeDefs, // Usar el schema definido arriba
        resolvers, // Usar los resolvers definidos arriba
        introspection: true,
        csrfPrevention: false,
        validationRules: [depthLimit(10)], // Limitar profundidad de queries
        plugins: [
            ApolloServerPluginLandingPageLocalDefault({ embed: true }),
            // Plugin para manejar el cierre limpio del servidor
            ApolloServerPluginDrainHttpServer({ httpServer: server.server }),
        ],
        // Manejo de errores personalizado
        formatError: (formattedError, error) => {
            // Log del error (puedes usar tu logger preferido)
            console.error("GraphQL Error:", error);

            // En desarrollo, mostrar más detalles
            if (process.env.NODE_ENV === "development") {
                return formattedError;
            }

            // En producción, ocultar detalles internos
            return {
                message: formattedError.message,
                code: formattedError.extensions?.code,
                path: formattedError.path,
            };
        },
    });
};

const apolloFastify = async (server: FastifyInstance) => {
    // Crear la instancia de Apollo Server
    const apollo = createApolloServer(server);

    // Inicializar Apollo Server
    await apollo.start();

    // Registrar hook para procesar multipart/form-data (file uploads)
    server.addHook(
        "preHandler",
        async (request: FastifyRequest, reply: FastifyReply) => {
            // Solo procesar uploads en la ruta GraphQL
            if (request.url === "/graphql" || request.url.startsWith("/graphql?")) {
                if (
                    request.method === "POST" &&
                    request.headers["content-type"] &&
                    request.headers["content-type"].includes("multipart/form-data")
                ) {
                    try {
                        // Procesar upload de archivos usando casting seguro
                        (request as any).body = await processRequest(
                            request.raw,
                            reply.raw
                        );
                    } catch (error: any) {
                        server.log.error("Error processing file upload:", error);
                        await reply.code(400).send({
                            error: "Error processing file upload",
                            details:
                                process.env.NODE_ENV === "development"
                                    ? error instanceof Error
                                        ? error.message
                                        : String(error)
                                    : undefined,
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

    // Agregar ruta de salud para GraphQL
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

    server.log.info("Apollo GraphQL server configured successfully");
    return server;
};

export default apolloFastify;
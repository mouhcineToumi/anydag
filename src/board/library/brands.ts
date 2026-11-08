import type { Blueprint } from "./types";

/**
 * The Technologies section: nodes that already wear a brand mark.
 *
 * Every atom is a *kind* of thing — a service, a store, a queue — and takes whichever icon its
 * props name. These are those atoms with a technology's name and its logo as the defaults, because
 * the thing a person is reaching for is the technology, not a kind of system: "give me a Postgres
 * box" is a question about postgres, and it is the search's own words that answer it (the haystack
 * reads what a blueprint quotes, so `store db "Database" "postgres"` and `icon=gcp:bigquery` are
 * findable the way a name-and-section one never was). A brand entry is a `Use` of an existing atom
 * with different props — the rendered text is the atom's own, defaults filled differently — so a
 * change to the `store` atom is a change to every one of these, as it is to the group and the
 * template above it.
 *
 * **Every brand here is one the icon vocabulary already ships** (`src/dsl/icon-names.ts` is the
 * closed set): the library test renders each entry clean, and an unknown name is a
 * `W_UNKNOWN_ICON` the same test refuses.
 */

/** The panel glyph is Lucide's, the mark is the brand's: two different icons, two different jobs. */
const tech = (id: string, use: string, brand: string, panel: string, name: string, description: string): Blueprint => ({
  id,
  layer: 0,
  type: "arch",
  name,
  description,
  icon: panel,
  brand: true,
  parts: [{ use, props: { title: name, meta: "", icon: brand } }],
});

export const BRANDS: Blueprint[] = [
  tech("part-arch-postgres", "part-arch-store", "postgresql", "Database", "Postgres", "arch · a store with the Postgres logo."),
  tech("part-arch-redis", "part-arch-store", "redis", "Database", "Redis", "arch · a store with the Redis logo."),
  tech("part-arch-mongodb", "part-arch-store", "mongodb", "Database", "MongoDB", "arch · a store with the MongoDB logo."),
  tech(
    "part-arch-elasticsearch",
    "part-arch-store",
    "elasticsearch",
    "Database",
    "Elasticsearch",
    "arch · a search store with the Elasticsearch logo.",
  ),
  tech("part-arch-kafka", "part-arch-queue", "kafka", "Radio", "Kafka", "arch · a queue with the Kafka logo."),
  tech("part-arch-rabbitmq", "part-arch-queue", "rabbitmq", "Radio", "RabbitMQ", "arch · a queue with the RabbitMQ logo."),
  tech("part-arch-nginx", "part-arch-service", "nginx", "Server", "Nginx", "arch · a service with the Nginx logo."),
  tech("part-arch-docker", "part-arch-container", "docker", "Container", "Docker", "arch · a container with the Docker logo."),
  tech(
    "part-arch-kubernetes",
    "part-arch-container",
    "kubernetes",
    "Container",
    "Kubernetes",
    "arch · a container with the Kubernetes logo.",
  ),
  tech(
    "part-arch-bigquery",
    "part-arch-store",
    "gcp:bigquery",
    "Database",
    "BigQuery",
    "arch · a warehouse with the BigQuery logo.",
  ),
];

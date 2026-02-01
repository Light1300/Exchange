import { createCliet } from "redis"

const client = createCliet();

client.connect();

export default client;
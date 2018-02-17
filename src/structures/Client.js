const { Client } = require('@spectacles/gateway');
const { Amqp } = require('@spectacles/brokers');
const { Client: Cache } = require('@spectacles/cache');
const { readdirSync } = require('fs');
const { extname, join } = require('path');
const { LavaLink } = require('voice');

class Delphinium extends Client {
	constructor(options = {}) {
		super(options.token, options);
		this.ready = false;
		this.eventPath = options.eventPath;
		this.consumer = new Amqp('consumer');
		this.publisher = new Amqp('publisher');
		this.rpc = new Amqp('rpc', { rpc: true });
		this.enableCache = Boolean(options.cache);
		if (this.enableCache) {
			this.cache = new Cache({
				port: 6379,
				host: process.env.REDIS,
				db: 0
			});
		}
		this.enableVoice = Boolean(options.voice);
		if (this.enableVoice) {
			this.lavalink = new LavaLink(this);
			this.lavalink.createNode({
				gateway: process.env.GATEWAY,
				shards: process.env.SHARDS,
				user: process.env.USER,
				password: process.env.PASSWORD,
				host: process.env.HOST
			});
			this.voiceSessions = new Map();
		}
		this.unavailableGuilds = new Map();
		this.once('READY', packet => this._ready(packet));
	}

	_ready(packet) {
		packet.guilds.forEach(guild => {
			if (guild.unavailable) this.unavailableGuilds.set(guild.id, guild);
			else this.unavailableGuilds.delete(guild.id);
		});

		this.ready = true;
		this.emitReady();
	}

	emitReady() {
		const files = readdirSync(this.eventPath);
		for (let event of files) {
			if (extname(event) !== '.js') continue;
			event = require(join(this.eventPath, event));
			if (typeof event === 'function') event = new event(this);
			if (event.enabled && !event.gateway && !event.rpc) this.on(event.name, event._run.bind(event));
			if (event.enabled && (event.gateway || event.lava) && !event.rpc) this.publisher.on(event.name, event._run.bind(event));
			if (event.enabled && event.rpc && (!event.gateway || !event.lava)) this.rpc.on(event.name, event._run.bind(event));
		}
	}

	async login(url = 'localhost', events, rpcEvents) {
		try {
			const connection = await this.consumer.connect(url);
			await this.publisher.connect(connection);
			await this.rpc.connect(connection);

			await this.publisher.subscribe(events);
			await this.rpc.subscribe(rpcEvents);

			await this.spawn();
		} catch (error) {
			this.emit('error', error);
		}
	}
}

module.exports = Delphinium;

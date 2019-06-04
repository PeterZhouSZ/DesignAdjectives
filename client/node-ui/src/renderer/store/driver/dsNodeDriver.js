const Promise = require('bluebird');
const sio = require('socket.io-client');

let socket;

export function Training(x, y) {
  return { x, y };
}

export class DsDriver {
  constructor(port = 5234) {
    this.addr = `http://localhost:${port}`;
    socket = sio(this.addr);
    socket.emitAsync = Promise.promisify(socket.emit);
    this.sampleCallback = null;
    this.connectCallback = null;
    this.sampleFinalCallback = null;
    this.connected = false;
    this.snippetServerOnline = false;

    this.bind();
  }

  bind() {
    const self = this;

    socket.on('connect', function() {
      console.log(`Snippets Node Driver connected to ${self.addr}`);
      self.connected = true;

      if (self.connectCallback)
        self.connectCallback(self.connected, self.snippetServerOnline);
    });

    socket.on('getType', function(cb) {
      // eslint-disable-next-line standard/no-callback-literal
      cb('client');
    });

    socket.on('disconnect', function() {
      console.log(`Snippets Node Driver disconnected from ${self.addr}`);
      self.connected = false;
      self.snippetServerOnline = false;

      if (self.connectCallback)
        self.connectCallback(self.connected, self.snippetServerOnline);
    });

    socket.on('single sample', function(data, snippetName) {
      self.sampleReturned(data, snippetName);
    });

    socket.on('sampler complete', function(data, snippetName) {
      self.samplerComplete(data, snippetName);
    });

    socket.on('no server', function() {
      console.log('No server connected. Unable to use snippet functions.');
      self.snippetServerOnline = false;

      if (self.connectCallback)
        self.connectCallback(self.connected, self.snippetServerOnline);
    });

    socket.on('server ok', function() {
      console.log('Snippet server online');
      self.snippetServerOnline = true;

      if (self.connectCallback)
        self.connectCallback(self.connected, self.snippetServerOnline);
    });
  }

  disconnect() {
    socket.close();
    this.connected = false;
    this.snippetServerOnline = false;

    if (this.connectCallback)
      this.connectCallback(this.connected, this.snippetServerOnline);
  }

  /**
   * This is the function that gets executed when a sample gets returned from the server.
   * @param {Object} data
   * @param {number[]} data.x Feature vector, numeric
   * @param {number} data.mean Mean value of the GPR at this point
   * @param {number} data.cov Covariance of the GPR at this point
   * @param {number} data.idx Sample Index
   * @param {string} snippetName Snippet ID
   */
  sampleReturned(data, snippetName) {
    console.log(
      `Received sample for snippet ${snippetName} with id ${data.idx}`
    );

    if (this.sampleCallback) this.sampleCallback(data, snippetName);
  }

  /**
   * Accepts a final message from the server containing all generated samples.
   * @param {Object} data
   * @param {string} snippetName
   */
  samplerComplete(data, snippetName) {
    console.log(`Received final snippet data from ${snippetName}`);

    if (this.sampleFinalCallback) this.sampleFinalCallback(data, snippetName);
  }

  // most functions in this driver will be using the async/await format to pretend
  // like this is synchronous
  /**
   * Utility function to call functions on the server
   * @param {string} fn Function identifier (see dsServer.py)
   * @param {Object} args Object containing arguments to forward to the server
   */
  async exec(fn, args) {
    try {
      const res = await socket.emitAsync('action', { fn, args });
      return res;
    } catch (e) {
      console.log(`Error: ${e}`);
    }
  }

  // and here's a function that'll use the traditional callbacks if needed
  /**
   * Utility function to call functions on the server. Callback version.
   * @see exec
   * @param {string} fn Function identifier
   * @param {Object} args Object containing arguments to forward to the server
   * @param {function(data: Object)} cb Callback for returned data
   */
  execCb(fn, args, cb) {
    socket.emit('action', { fn, args }, cb);
  }

  // the following functions are basically convenience functions
  /**
   * Creates a new snippet. If a snippet already exists, the function returns false.
   * @param {string} name Snippet name
   * @return {boolean} True on success, false if a snippet already exists.
   */
  async addSnippet(name) {
    const res = await this.exec('add snippet', { name });
    return res;
  }

  /**
   * Deletes a snippet on the server
   * @param {string} name Snippet name
   */
  async deleteSnippet(name) {
    const res = await this.exec('delete snippet', { name });
    return res;
  }

  /**
   * @return {string[]} List of snippets that are currently available on the server.
   */
  async listSnippets() {
    const res = await this.exec('list snippets', {});
    return res;
  }

  /**
   * Sets the training data for the specified snippet.
   * @param {string} name Snippet name, required
   * @param {Object[]} data Data array. Consists of objects with fields {x: number[], y: number}
   */
  async setData(name, data) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet set data', { name, data });
    return res;
  }

  /**
   * Adds a single data point to the specified snippet.
   * @param {string} name Snippet name
   * @param {number[]} x Feature vector
   * @param {number} y Preference score
   */
  async addData(name, x, y) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet add data', { name, x, y });
    return res;
  }

  /**
   * Removes a training point from a snippet.
   * @param {string} name Snippet name
   * @param {number} index Integer array index indicating value to remove
   */
  async removeData(name, index) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet remove data', { name, index });
    return res;
  }

  /**
   * Starts the training process for the specified snippet.
   * @param {string} name Snippet name
   * @return {Object} Contains information about the learned GPR values. Client applications should save.
   */
  async train(name) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet train', { name });
    return res;
  }

  /**
   * Asks the server to display the loss graph from the specified snippet.
   * This is unavailable if the snippet was loaded from a client application instead of recently trained.
   * @param {string} name Snippet name
   */
  async showLoss(name) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet plotLastLoss', { name });
    return res;
  }

  /**
   * Asks the server to display a plot of the GPR over one dimension, with other dimensions held constant.
   * @param {string} name Snippet name
   * @param {number[]} x Current feature vector
   * @param {number} dim Index of the dimension to plot over in feature space, numeric between 0 and x.length
   * @param {number} rmin minimum value for the specified dimension
   * @param {number} rmax maximum value for the specified dimension
   * @param {number} n Number of samples to take between min and max
   */
  async plot1D(name, x, dim, rmin = 0.0, rmax = 1.0, n = 100) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet plot1D', {
      name,
      x,
      dim,
      rmin,
      rmax,
      n
    });
    return res;
  }

  /**
   * Returns the value and covariance of the GPR at point x
   * @param {string} name Snippet name
   * @param {number[]} x Feature vector
   * @return {Object} Contains fields "mean" and "cov"
   */
  async predictOne(name, x) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet predict one', { name, data: x });
    return res;
  }

  /**
   * Predicts multiple data points at the same time.
   * @param {string} name Snippet name
   * @param {number[][]} data Prediction points
   * @return {Object} Contains fields "mean" and "cov", number[]
   */
  async predict(name, data) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet predict', { name, data });
    return res;
  }

  /**
   * Start sampling the specified snippet
   * @param {string} name Snippet name
   * @param {Object} params Sampling parameters. See below for some common options.
   * @param {number[]} params.x0 Initial feature vector
   * @param {?number} params.qMin quality threshold
   * @param {?number} params.epsilon sample difference threshold
   * @param {?number} params.n Number of samples to return
   * @param {?number} params.burn Burn-in time
   * @param {?number} params.limit Number of samples to evaluate. Upper bound on sampling runtime
   * @param {?number} params.stride Number of samples to skip between accepts
   * @param {?number} params.scale Step size
   */
  async sample(name, params) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet sample', { name, data: params });
    return res;
  }

  /**
   * Generic property setter for snippets
   * @param {string} name Snippet name
   * @param {string} propName property name
   * @param {number|string} val property value
   */
  async setProp(name, propName, val) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet setProp', { name, propName, val });
    return res;
  }

  /**
   * Generic property accessor for snippets
   * @param {string} name snippet name
   * @param {string} propName property name
   */
  async getProp(name, propName) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    const res = await this.exec('snippet getProp', { name, propName });
    return res;
  }

  /**
   * Loads the GPR from saved data.
   * @param {string} name Snippet name
   * @param {Object[]} trainData Training data points, {x, y}
   * @param {Object} kernelData Should have the same contents as returned from the train function
   * @see train
   */
  async loadGPR(name, trainData, kernelData) {
    if (typeof name !== 'string') throw new Error('Missing Snippet Name');

    await this.setData(name, trainData);
    const res = await this.exec('snippet load gpr', { name, kernelData });
    return res;
  }

  /**
   * Stop the sampler
   */
  async stopSampler() {
    const res = await this.exec('stop sampler');
    return res;
  }

  /**
   * @return {boolean} True if the sampler is running, false otherwise
   */
  async samplerRunning() {
    const res = await this.exec('sampler running');
    return res;
  }

  /**
   * Deletes all snippets from the server, resets running conditions to as-launched
   */
  async reset() {
    await this.exec('reset');
    console.log('Server reset performed');
  }
}

export default DsDriver;

const io = require("socket.io")(5234);
const winston = require("winston");
const { spawn } = require("child_process");
const { format } = require("logform");

const alignedWithColorsAndTime = format.combine(
  format.colorize(),
  format.timestamp(),
  format.align(),
  format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);

const logger = winston.createLogger({
  format: format.combine(
    format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss"
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: alignedWithColorsAndTime,
      level: "debug"
    }),
    new winston.transports.File({ filename: "warn.log", level: "warn" }),
    new winston.transports.File({ filename: "combined.log", level: "silly" })
  ]
});

logger.info("Attempting to initialize Design Snippets Server...");

// spawn child process for server
const snippetServer = spawn("python3", ["./dsServer.py"]);
snippetServer.on("close", code => {
  logger.info(`Snippet Server closed with code ${code}`);
});

var snippetSocket;

logger.info("Initializing socket.io");

io.on("connect", function(socket) {
  logger.info(`connection from ${socket.id}`);

  // determine if client or server connected
  socket.emit("getType", function(type) {
    if (type === "server") {
      if (!snippetSocket) {
        snippetSocket = socket;
        logger.info(`Design Snippets Server found. id: ${socket.id}`);
      } else {
        logger.error("Server already connected. Disconnect other server first");
      }
    }
  });

  socket.on("disconnect", function() {
    if (snippetSocket && snippetSocket.id === socket.id) {
      snippetSocket = null;
      logger.warn("Snippet server disconnected");
    }

    logger.info(`disconnect: ${socket.id}`);
  });

  socket.on("action", function(data, clientCB) {
    if (snippetSocket) {
      logger.log(
        "verbose",
        'Relaying action "%s". Args: %j.',
        data.fn,
        data.args
      );
      snippetSocket.emit(data.fn, data.args, function(result) {
        logger.log("verbose", "Relayed action returned %j", result);
        clientCB(result);
      });
    } else {
      logger.warn("Unable to process action. No snippet server connected");
    }
  });
});

logger.info("Initialized Design Snippets relay server on port 5234");

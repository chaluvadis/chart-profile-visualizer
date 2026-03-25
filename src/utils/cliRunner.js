"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
exports.runKubectl = runKubectl;
exports.runHelm = runHelm;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
async function runCommand(binary, args, options) {
    return execFileAsync(binary, args, {
        ...options,
        encoding: "utf8",
    });
}
async function runKubectl(args, options) {
    return runCommand("kubectl", args, options);
}
async function runHelm(args, options) {
    return runCommand("helm", args, options);
}
//# sourceMappingURL=cliRunner.js.map
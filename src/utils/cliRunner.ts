import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export type CliCommandOptions = Omit<ExecFileOptions, "encoding">;

export async function runCommand(
	binary: string,
	args: string[],
	options?: CliCommandOptions
): Promise<{ stdout: string; stderr: string }> {
	return execFileAsync(binary, args, {
		...options,
		encoding: "utf8",
	});
}

export async function runKubectl(
	args: string[],
	options?: CliCommandOptions
): Promise<{ stdout: string; stderr: string }> {
	return runCommand("kubectl", args, options);
}

export async function runHelm(
	args: string[],
	options?: CliCommandOptions
): Promise<{ stdout: string; stderr: string }> {
	return runCommand("helm", args, options);
}

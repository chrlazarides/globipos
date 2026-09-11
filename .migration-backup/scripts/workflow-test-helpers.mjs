import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("yaml");

export function parseYaml(source, description) {
  try {
    return parse(source);
  } catch (error) {
    assert.fail(`${description} must contain valid YAML: ${error.message}`);
  }
}

export function parseWorkflow(source, description) {
  return parseYaml(source, description);
}

export function workflowJob(workflow, jobName, description) {
  const job = workflow?.jobs?.[jobName];
  assert.ok(job, `${description} must keep the ${jobName} job`);
  return job;
}

export function workflowJobSteps(workflow, jobName, description) {
  const job = workflowJob(workflow, jobName, description);
  assert.ok(Array.isArray(job.steps), `${description} ${jobName} must define steps`);
  return job.steps;
}

export function workflowSteps(workflow, description) {
  const jobs = workflow?.jobs;
  assert.ok(jobs && typeof jobs === "object", `${description} must define jobs`);

  return Object.entries(jobs).flatMap(([jobName, job]) => {
    assert.ok(Array.isArray(job?.steps), `${description} ${jobName} must define steps`);
    return job.steps;
  });
}

export function actionReferences(workflow, description) {
  return workflowSteps(workflow, description)
    .filter((step) => typeof step?.uses === "string")
    .map((step) => step.uses);
}

export function assertJobRuns(job, command, message) {
  const runsCommand = job?.steps?.some(
    (step) =>
      typeof step?.run === "string" &&
      step.run.split("\n").some((line) => {
        const trimmed = line.trim();
        return trimmed === command || trimmed.startsWith(`${command} `);
      }),
  );
  assert.ok(runsCommand, message);
}
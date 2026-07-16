import type { ModuleType } from "@inspection/contracts";

export type VerifiedSkill = {
  readonly name: string;
  readonly version: string;
  readonly compatibleModules: readonly (ModuleType | "shared")[];
  readonly sourceStatus: "verified" | "draft_unverified";
  readonly instructions: string;
};

type SkillLoader = () => VerifiedSkill | Promise<VerifiedSkill>;

export class AllowlistedSkillRegistry {
  readonly #loaders: ReadonlyMap<string, SkillLoader>;
  readonly #loaded = new Map<string, VerifiedSkill>();

  constructor(loaders: Readonly<Record<string, SkillLoader>>) {
    this.#loaders = new Map(Object.entries(loaders));
  }

  availableNames(): readonly string[] {
    return Object.freeze([...this.#loaders.keys()].sort());
  }

  async load(input: {
    readonly name: string;
    readonly allowedModules: readonly ModuleType[];
    readonly requiredVersion?: string;
  }): Promise<VerifiedSkill> {
    const cached = this.#loaded.get(input.name);
    const skill = cached ?? (await this.#load(input.name));
    if (skill.sourceStatus !== "verified") {
      throw new Error(`Skill ${input.name} is not approved for model use`);
    }
    if (
      input.requiredVersion !== undefined &&
      skill.version !== input.requiredVersion
    ) {
      throw new Error(
        `Skill ${input.name} does not match the packet version pin`,
      );
    }
    const compatible =
      skill.compatibleModules.includes("shared") ||
      input.allowedModules.some((module) =>
        skill.compatibleModules.includes(module),
      );
    if (!compatible) {
      throw new Error(`Skill ${input.name} is not compatible with this packet`);
    }
    this.#loaded.set(input.name, skill);
    return skill;
  }

  loaded(): readonly VerifiedSkill[] {
    return Object.freeze([...this.#loaded.values()]);
  }

  async #load(name: string): Promise<VerifiedSkill> {
    const loader = this.#loaders.get(name);
    if (loader === undefined) {
      throw new Error(`Skill ${name} is not allowlisted`);
    }
    const skill = await loader();
    if (skill.name !== name) {
      throw new Error(
        `Skill loader returned the wrong skill identity for ${name}`,
      );
    }
    return Object.freeze({ ...skill });
  }
}

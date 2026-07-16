import { createReportSnapshot } from "./report-types.js";
import type { ReportSnapshot } from "./report-types.js";

const inspector = {
  displayName: "Alex Inspector",
  credential:
    "Queensland completed residential building inspection - demo credential v1",
  confirmedAt: "2026-07-15T04:05:00.000Z",
} as const;

export function createSyntheticRecipientReport(): ReportSnapshot {
  return createReportSnapshot({
    schemaVersion: "recipient-report-v1",
    reportVersionId: "report_demo_v2",
    versionNumber: 2,
    organizationId: "org_demo",
    jobId: "job_demo_cracked_tile",
    propertyLabel: "12 Example Street, Mermaid Waters QLD (synthetic)",
    inspectionDate: "2026-07-15T00:00:00.000Z",
    issuedAt: "2026-07-15T04:15:00.000Z",
    templateVersion: "recipient-report-template-v1",
    amendment: {
      priorReportVersionId: "report_demo_v1",
      reason: "Clarified the extent of cracked floor tiles",
      changedAt: "2026-07-15T04:12:00.000Z",
      changedBy: inspector.displayName,
      changeNotice:
        "Version 2 replaces version 1. The earlier version and its delivery history remain available in report records.",
    },
    building: {
      module: "building",
      conclusion:
        "The accessible areas inspected include one major defect and several minor defects. Refer to each finding and the access limitation below.",
      minorDefectSummary:
        "Several minor defects were observed, including a loose door stop and localised sealant deterioration.",
      inspector,
      findings: [
        {
          findingId: "finding_cracked_tiles",
          module: "building",
          title: "Cracked shower and bathroom floor tiles",
          location: "Second-floor main bathroom",
          classification: "major_defect",
          observation:
            "Cracking was observed through several tiles in the shower base and main bathroom floor area.",
          apparentExtent:
            "Cracking extends across the shower base and multiple tiles in the adjoining bathroom floor.",
          significance:
            "Movement within the floor assembly may have affected the waterproofing membrane and may permit moisture entry to concealed elements.",
          qualifiedOpinion:
            "The pattern is consistent with possible movement in the floor or subfloor assembly. The concealed construction and membrane condition were not visually confirmed.",
          uncertainty: [
            "The floor framing, tile underlay and waterproofing membrane were concealed from view.",
            "No invasive testing was undertaken.",
          ],
          furtherInvestigation:
            "Engage a suitably licensed and qualified builder or tiler to investigate the floor assembly and waterproofing condition.",
          inspector,
          curatedMedia: [
            {
              artifactId: "media_bathroom_context",
              contentHash: "a".repeat(64),
              module: "building",
              findingId: "finding_cracked_tiles",
              transformation: "safe_proxy",
              altText:
                "Wide view of the second-floor bathroom showing cracked floor tiles",
              caption:
                "Inspector-selected context image. Cracking is visible through several floor tiles.",
            },
            {
              artifactId: "media_tile_annotation",
              contentHash: "b".repeat(64),
              module: "building",
              findingId: "finding_cracked_tiles",
              transformation: "annotation",
              altText:
                "Annotated close view identifying cracks through two shower-base tiles",
              caption:
                "Inspector annotation identifies the observed cracking. The original remains immutable and private.",
            },
          ],
        },
        {
          findingId: "finding_door_stop",
          module: "building",
          title: "Loose door stop",
          location: "Ground-floor hallway",
          classification: "minor_defect",
          observation:
            "The wall-mounted door stop was loose at the time of inspection.",
          apparentExtent: "One door stop was affected.",
          significance:
            "Continued movement may damage the adjacent wall finish.",
          qualifiedOpinion:
            "The condition appears localised to the observed fitting.",
          uncertainty: [],
          furtherInvestigation: null,
          inspector,
          curatedMedia: [],
        },
      ],
      limitations: [
        {
          limitationId: "limitation_roof_void",
          module: "building",
          area: "Roof void above the rear bedroom",
          description:
            "Stored contents and restricted clearance prevented access to this section.",
          material: true,
          effectOnConclusion:
            "The condition of concealed framing in this section could not be visually assessed.",
        },
      ],
    },
    timberPest: {
      module: "timber_pest",
      conclusion:
        "No visible evidence of timber pest activity was observed in the accessible areas at the time of inspection. Concealed or inaccessible elements were not assessed, and one conducive condition was recorded.",
      inspector,
      findings: [
        {
          findingId: "finding_no_visible_pest",
          module: "timber_pest",
          title: "Accessible areas inspected",
          location: "Accessible internal and external areas",
          category: "no_visible_evidence",
          observation:
            "No visible evidence of timber pest activity was observed in the accessible areas at the inspection time.",
          apparentExtent:
            "The statement is limited to the accessible areas described in this report.",
          significance:
            "Concealed or inaccessible timber may contain conditions that were not visible.",
          qualifiedOpinion:
            "This is a visual observation at the inspection time and is not a guarantee that concealed timber pest activity is absent.",
          uncertainty: [
            "Wall cavities, concealed framing and inaccessible roof-void sections were not visible.",
          ],
          furtherInvestigation: null,
          inspector,
          curatedMedia: [],
        },
        {
          findingId: "finding_garden_bed",
          module: "timber_pest",
          title: "Garden bed against external wall",
          location: "Eastern external wall",
          category: "conducive_condition",
          observation:
            "Garden soil and mulch were observed against the lower external wall.",
          apparentExtent:
            "Approximately three metres of the eastern wall is affected.",
          significance:
            "The arrangement restricts visibility of the lower wall and may retain moisture near concealed timber elements.",
          qualifiedOpinion:
            "The observed arrangement is a conducive condition requiring further assessment of the concealed interface.",
          uncertainty: [
            "The wall cavity and concealed lower framing were not visible.",
          ],
          furtherInvestigation:
            "Engage a suitably qualified timber pest inspector to assess the concealed interface when access is available.",
          inspector,
          curatedMedia: [],
        },
      ],
      limitations: [
        {
          limitationId: "limitation_concealed_timber",
          module: "timber_pest",
          area: "Concealed wall and floor framing",
          description:
            "The inspection was visual and did not expose concealed timber elements.",
          material: true,
          effectOnConclusion:
            "The conclusion does not extend to timber that was concealed from view.",
        },
      ],
    },
  });
}

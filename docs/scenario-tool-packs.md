# Scenario tool packs

To add a hackathon domain: implement deterministic `NexusToolDefinition` executors, declare each tool's argument kind and eligible agents, register the pack for the scenario context, then pass that context to the existing investigation flow. Agents receive only the resolved tools; executors validate arguments and create ordinary EvidenceRecords. Do not add formulas to LLM prompts.

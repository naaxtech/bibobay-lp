import { singletonTypes } from "./documents/singletons";
import { collectionTypes } from "./documents/collections";
import { objectTypes } from "./objects";

export const schemaTypes = [...singletonTypes, ...collectionTypes, ...objectTypes];

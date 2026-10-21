# Shared field-operations Kit

Identity: `field_operations_shared@0.1`. Bundle: `hazard_register@0.1`.
This is a content-only directory copy of the project's independently authored
`field_operations@0.1` teaching Kit. It keeps the original methods, schema,
validation, panel declaration, renderer and synthetic example; the Kit name and
the English/Chinese register labels are customized. See NOTICE and LICENSE.

Copy this entire directory, including `mindset.md`, `skills/`, LICENSE and NOTICE,
to a new directory you own. Pass that absolute directory to the installed host's
existing Kit loader/catalog integration. The supported content shape is a
directory; this example does not introduce a ZIP installer, marketplace, or
universal host registration command. A Git checkout may transport the same
directory, but automatic Git installation is not demonstrated here.

For ZIP sharing, archive the whole `field-operations-shared/` directory. The
recipient first extracts it into a new directory they own, then passes the
extracted `field-operations-shared` directory (the one containing `mindset.md`)
to the same host loader described above. Keep LICENSE and NOTICE with the
content. Sending or extracting a ZIP does not register the Kit automatically;
do not pass the `.zip` file itself to the directory loader.

### Receive a Git-shared Kit

Keep the complete Kit directory, including LICENSE and NOTICE, in the shared
repository. Clone it into a new directory you own:

```sh
git clone <shared-kit-repository> /absolute/new-checkout
```

Pass the cloned Kit directory containing `mindset.md` to the existing loader
below, not the `.git` directory or repository URL. For a repository with this
Kit at `field-operations-shared/`, that directory is
`/absolute/new-checkout/field-operations-shared`.
Local Git commit/clone transport has been read back through an installed public
loader: the Kit and Bundle versions, both customized register labels and the two
nonempty synthetic examples were preserved with all 14 files, LICENSE and NOTICE.
This verifies local content transport and loading; automatic Git installation,
remote hosting, cross-machine use and Kits with runtime dependencies remain
unverified. Cloning does not register a Kit or change a project's pinned version.

For an integration using public APIs, call
`loadDesignKit(fs, absoluteKitDirectory, {sourceId: 'directory:' + absoluteKitDirectory})`
from `dsh-design-core/kit`, using the host's confined filesystem adapter. Confirm
the loaded identity and the localized register labels before selecting it for
a project. Do not overwrite an existing project or silently switch its pinned Kit.

The delivered copy was imported from another clean directory through an actual
installed official host's public loader; both customized labels and unchanged
nonempty example were read back. This verifies content copying/loading, not
host registration, browser editing, Agent generation or continued execution.
Those activities require their own actual host session and model credentials.

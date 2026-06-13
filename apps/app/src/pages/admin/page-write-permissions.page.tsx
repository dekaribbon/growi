import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const PageWritePermissions = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import(
      // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
      '~/features/page-write-permission/client/components/PageWritePermissions'
    ).then((mod) => mod.PageWritePermissions),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminPageWritePermissionsPage: NextPageWithLayout<Props> = () => (
  <PageWritePermissions />
);

AdminPageWritePermissionsPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, _t) => 'Page Write Permissions',
});

export const getServerSideProps: GetServerSideProps =
  getServerSideAdminCommonProps;

export default AdminPageWritePermissionsPage;

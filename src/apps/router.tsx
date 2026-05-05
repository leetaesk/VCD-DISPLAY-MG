import { createBrowserRouter } from 'react-router-dom';

import Layout from '@/apps/layout/Layout';
import HomePage from '@/ui/home/HomePage';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [{ index: true, element: <HomePage /> }],
  },
]);

export default router;

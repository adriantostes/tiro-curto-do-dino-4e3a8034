-- Allow admins to view all payments
CREATE POLICY "Admins can view all payments"
ON public.payments
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all participants
CREATE POLICY "Admins can view all participants"
ON public.participants
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all payment_items
CREATE POLICY "Admins can view all payment_items"
ON public.payment_items
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));